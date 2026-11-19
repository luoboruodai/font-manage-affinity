import AppKit
import CoreText
import Foundation

private let languageOrder = ["latin", "zh-Hans", "zh-Hant", "ja", "ko", "numbers", "symbols"]

private enum Script: String, Decodable {
    case kana, hangul

    func contains(_ character: Character) -> Bool {
        character.unicodeScalars.contains { scalar in
            switch self {
            case .kana: return (0x3041...0x3096).contains(scalar.value) || (0x30A1...0x30FA).contains(scalar.value)
            case .hangul: return (0xAC00...0xD7A3).contains(scalar.value)
            }
        }
    }
}

private struct CoverageRule: Decodable {
    let core: String
    let common: String
    let minCore: Double
    let minOverall: Double
    let requiredScript: Script?
    let excludePostScript: [String]?
}

private struct CoverageConfig: Decodable {
    let excludePostScript: [String]?
    let languages: [String: CoverageRule]

    static func load() throws -> CoverageConfig {
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let checkout = URL(fileURLWithPath: CommandLine.arguments[0])
            .standardizedFileURL.deletingLastPathComponent().deletingLastPathComponent()
        let paths = [cwd, checkout].map { $0.appendingPathComponent("config/coverage.json") }
        guard let path = CommandLine.arguments.dropFirst().first.map({ URL(fileURLWithPath: $0) })
                ?? paths.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode(CoverageConfig.self, from: Data(contentsOf: path))
    }
}

private func sampleCharacters(_ value: String) -> [Character] {
    var seen = Set<Character>()
    return value.filter { character in
        !character.isWhitespace && character.unicodeScalars.contains { scalar in
            switch scalar.properties.generalCategory {
            case .control, .format, .nonspacingMark, .spacingMark, .enclosingMark: return false
            default: return true
            }
        } && seen.insert(character).inserted
    }
}

private struct CoverageProbe {
    let language: String
    let core: [Character]
    let overall: [Character]
    let minCore: Double
    let minOverall: Double
    let requiredScript: Script?
    let excluded: Set<String>

    init(language: String, rule: CoverageRule, globallyExcluded: [String]) throws {
        self.language = language
        core = sampleCharacters(rule.core)
        overall = sampleCharacters(rule.core + " " + rule.common)
        minCore = rule.minCore
        minOverall = rule.minOverall
        requiredScript = language == "ja" ? .kana : language == "ko" ? .hangul : rule.requiredScript
        excluded = Set(globallyExcluded + (rule.excludePostScript ?? []))
        guard !core.isEmpty, (0...1).contains(minCore), (0...1).contains(minOverall),
              requiredScript.map({ script in core.contains(where: script.contains) }) ?? true else {
            throw CocoaError(.fileReadCorruptFile)
        }
    }

    func evaluate(id: String, supports: Set<Character>) -> (supported: Bool, details: [String: Any]) {
        let matchedCore = core.count(where: supports.contains)
        let missing = overall.filter { !supports.contains($0) }
        let matchedOverall = overall.count - missing.count
        let coreRatio = Double(matchedCore) / Double(core.count)
        let ratio = Double(matchedOverall) / Double(overall.count)
        let missingCore = core.filter { !supports.contains($0) }
        let reason: String
        if excluded.contains(id) { reason = "excluded-font" }
        else if matchedCore == 0 { reason = "no-coverage" }
        else if let script = requiredScript,
                !core.contains(where: { script.contains($0) && supports.contains($0) }) {
            reason = "required-script-missing"
        } else if coreRatio < minCore { reason = "below-core-threshold" }
        else if ratio < minOverall { reason = "partial-coverage" }
        else { reason = "supported" }
        let supported = reason == "supported" || reason == "partial-coverage"
        return (supported, [
            "supported": supported, "coreRatio": coreRatio, "ratio": ratio,
            "missing": missing.map(String.init), "missingCore": missingCore.map(String.init),
            "reason": reason,
            "matchedCore": matchedCore, "matchedOverall": matchedOverall,
            "totalCore": core.count, "totalOverall": overall.count
        ])
    }
}

private func origin(_ descriptor: CTFontDescriptor) -> URL? {
    (CTFontDescriptorCopyAttribute(descriptor, kCTFontURLAttribute) as? URL)?
        .standardizedFileURL.resolvingSymlinksInPath()
}

private func origin(_ font: CTFont) -> URL? {
    (CTFontCopyAttribute(font, kCTFontURLAttribute) as? URL)?
        .standardizedFileURL.resolvingSymlinksInPath()
}

private struct Variation {
    let variable: Bool
    let issue: String?
}

private func variation(_ font: CTFont, descriptor: CTFontDescriptor) -> Variation {
    let axes = CTFontCopyVariationAxes(font) as? [[String: Any]] ?? []
    let instance = CTFontCopyVariation(font) as? [NSNumber: NSNumber] ?? [:]
    let requested = CTFontDescriptorCopyAttribute(descriptor, kCTFontVariationAttribute) as? [NSNumber: NSNumber] ?? [:]
    let problem = Variation(variable: true, issue: "无法确认可变字体实例的轴值。")
    if axes.isEmpty {
        return instance.isEmpty && requested.isEmpty ? Variation(variable: false, issue: nil) : problem
    }
    var identifiers = Set<NSNumber>()
    for axis in axes {
        guard let id = axis[kCTFontVariationAxisIdentifierKey as String] as? NSNumber,
              let minimum = (axis[kCTFontVariationAxisMinimumValueKey as String] as? NSNumber)?.doubleValue,
              let maximum = (axis[kCTFontVariationAxisMaximumValueKey as String] as? NSNumber)?.doubleValue,
              let standard = (axis[kCTFontVariationAxisDefaultValueKey as String] as? NSNumber)?.doubleValue,
              minimum.isFinite, maximum.isFinite, standard.isFinite,
              minimum <= standard, standard <= maximum,
              identifiers.insert(id).inserted else { return problem }
        let value = instance[id]?.doubleValue ?? standard
        guard value.isFinite, value >= minimum, value <= maximum else { return problem }
        if let expected = requested[id]?.doubleValue,
           !expected.isFinite || abs(expected - value) > 0.001 { return problem }
    }
    guard Set(instance.keys).isSubset(of: identifiers), Set(requested.keys).isSubset(of: identifiers) else { return problem }
    return Variation(variable: true, issue: nil)
}

private func kind(_ font: CTFont) -> (serif: Bool, sans: Bool) {
    let fontClass = CTFontGetSymbolicTraits(font).rawValue >> 28
    switch fontClass {
    case 1...5, 7: // CoreText's six serif classes.
        return (true, false)
    case 8:
        return (false, true)
    case 0:
        // OpenType OS/2 offsets 32–33 are the PANOSE family and serif-style bytes.
        if let data = CTFontCopyTable(font, CTFontTableTag(0x4F532F32), []) as Data?, data.count >= 34, data[32] == 2 {
            switch data[33] {
            case 2...10: return (true, false)
            case 11...15: return (false, true)
            default: break
            }
        }
        return (false, false)
    default:
        return (false, false)
    }
}

private struct Face {
    let descriptor: CTFontDescriptor
    let font: CTFont
    let url: URL?
    let axes: Variation
}

private struct Cluster {
    let character: Character
    let start: Int
    let end: Int
}

private func clusters(in text: String) -> [Cluster] {
    var start = 0
    return text.map { character in
        let end = start + character.utf16.count
        defer { start = end }
        return Cluster(character: character, start: start, end: end)
    }
}

private func lineText(_ text: String, font: CTFont) -> NSAttributedString {
    NSAttributedString(string: text, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 1, alpha: 0.9)
    ])
}

private struct Diagnostics {
    private(set) var fallback = Set<String>()
    private(set) var fallbackBlocked = false
    private(set) var missing = Set<Int>()

    mutating func inspect(_ line: CTLine, font: CTFont, id: String, url: URL?, offset: Int, clusters: [Cluster],
                          draw: ((CTRun, CFRange) -> Void)? = nil) {
        func markMissing(_ start: Int, _ end: Int) {
            for (index, cluster) in clusters.enumerated()
            where cluster.start < offset + end && cluster.end > offset + start && !cluster.character.isWhitespace {
                missing.insert(index)
            }
        }
        for run in CTLineGetGlyphRuns(line) as! [CTRun] {
            let count = CTRunGetGlyphCount(run)
            if count == 0 { continue }
            let source = CTRunGetStringRange(run)
            let end = source.location + source.length
            let attributes = CTRunGetAttributes(run) as NSDictionary
            guard let runFont = attributes[kCTFontAttributeName] else {
                fallbackBlocked = true
                markMissing(source.location, end)
                continue
            }
            let shaped = runFont as! CTFont
            if shaped !== font {
                let shapedName = CTFontCopyPostScriptName(shaped) as String
                if shapedName != id || (url != nil && origin(shaped) != url) {
                    fallbackBlocked = true
                    fallback.insert(shapedName)
                    markMissing(source.location, end)
                    continue
                }
            }
            var glyphs = Array(repeating: CGGlyph(0), count: count)
            CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
            if !glyphs.contains(0) {
                draw?(run, CFRange(location: 0, length: count))
                continue
            }
            var indices = Array(repeating: CFIndex(0), count: count)
            CTRunGetStringIndices(run, CFRange(location: 0, length: count), &indices)
            let starts = Set(indices).sorted()
            for position in glyphs.indices where glyphs[position] == 0 {
                let start = indices[position]
                markMissing(start, starts.first(where: { $0 > start }) ?? end)
            }
            if let draw {
                var current = 0
                while current < count {
                    if glyphs[current] == 0 { current += 1; continue }
                    let first = current
                    repeat { current += 1 } while current < count && glyphs[current] != 0
                    draw(run, CFRange(location: first, length: current - first))
                }
            }
        }
    }
}

private struct Paragraph {
    let text: String
    let offset: Int
}

private struct PreviewLine {
    let line: CTLine
    let offset: Int
    let ascent: CGFloat
    let descent: CGFloat
    let xOffset: CGFloat
    let width: CGFloat

    init(_ line: CTLine, offset: Int, font: CTFont) {
        self.line = line
        self.offset = offset
        let ink = CTLineGetBoundsWithOptions(line, [.useGlyphPathBounds])
        ascent = max(CTFontGetAscent(font), ink.maxY)
        descent = max(CTFontGetDescent(font), -ink.minY)
        xOffset = max(0, -ink.minX)
        let advance = CTLineGetTypographicBounds(line, nil, nil, nil) - CTLineGetTrailingWhitespaceWidth(line)
        width = max(advance, ink.maxX) + xOffset
    }
}

private func paragraphs(in text: String) -> [Paragraph] {
    var parts: [Paragraph] = []
    var offset = 0
    var start = 0
    var paragraph = ""
    for character in text {
        offset += character.utf16.count
        if character.isNewline {
            parts.append(Paragraph(text: paragraph, offset: start))
            paragraph = ""
            start = offset
        } else {
            paragraph.append(character)
        }
    }
    parts.append(Paragraph(text: paragraph, offset: start))
    return parts
}

private func layout(_ paragraphs: [Paragraph], font: CTFont, width: CGFloat) -> [PreviewLine] {
    paragraphs.flatMap { paragraph -> [PreviewLine] in
        let text = lineText(paragraph.text, font: font)
        if text.length == 0 {
            return [PreviewLine(CTLineCreateWithAttributedString(text), offset: paragraph.offset, font: font)]
        }
        let boundaries = clusters(in: paragraph.text).map(\.end)
        let typesetter = CTTypesetterCreateWithAttributedString(text)
        var start = 0
        var lines: [PreviewLine] = []
        while start < text.length {
            // Word wrapping where possible. Keep whole graphemes when a long word breaks.
            let suggested = start + CTTypesetterSuggestLineBreak(typesetter, start, width)
            guard let next = boundaries.first(where: { $0 > start }) else { break }
            let end = max(next, boundaries.last(where: { $0 <= suggested }) ?? next)
            let line = CTTypesetterCreateLine(typesetter, CFRange(location: start, length: end - start))
            lines.append(PreviewLine(line, offset: paragraph.offset, font: font))
            start = end
        }
        return lines
    }
}

private final class FontEngine {
    private var faces: [String: Face] = [:]
    private var fontList: [[String: Any]]?
    private let probes: [CoverageProbe]
    private let basicSamples: [Character]
    private let basicUnits: [UniChar]
    private let clusterSamples: [Character]

    init() throws {
        let config = try CoverageConfig.load()
        probes = try languageOrder.map { language in
            guard let rule = config.languages[language] else { throw CocoaError(.fileReadCorruptFile) }
            return try CoverageProbe(language: language, rule: rule, globallyExcluded: config.excludePostScript ?? [])
        }
        let samples = sampleCharacters(probes.map { String($0.overall) }.joined(separator: " "))
        var basic: [Character] = []
        var units: [UniChar] = []
        var clusters: [Character] = []
        for character in samples {
            if character.utf16.count == 1, let unit = character.utf16.first {
                basic.append(character)
                units.append(unit)
            } else {
                clusters.append(character)
            }
        }
        basicSamples = basic
        basicUnits = units
        clusterSamples = clusters
    }

    private func coverage(font: CTFont, id: String, url: URL?) -> (supports: [String], details: [String: Any]) {
        // Direct native mapping cannot trigger system fallback. Map simple probes
        // in one batch, then shape multi-unit probes to verify whole graphemes.
        var glyphs = Array(repeating: CGGlyph(0), count: basicUnits.count)
        if !basicUnits.isEmpty {
            _ = CTFontGetGlyphsForCharacters(font, basicUnits, &glyphs, basicUnits.count)
        }
        var available = Set(basicSamples.indices.compactMap { glyphs[$0] == 0 ? nil : basicSamples[$0] })
        if !clusterSamples.isEmpty {
            let charset = CTFontCopyCharacterSet(font) as CharacterSet
            let candidates = clusterSamples.filter { character in
                character.unicodeScalars.allSatisfy { scalar in
                    scalar.properties.isVariationSelector || scalar.properties.generalCategory == .format || charset.contains(scalar)
                }
            }
            let text = candidates.map(String.init).joined(separator: " ")
            let samples = clusters(in: text)
            let line = CTLineCreateWithAttributedString(lineText(text, font: font))
            var diagnostics = Diagnostics()
            diagnostics.inspect(line, font: font, id: id, url: url, offset: 0, clusters: samples)
            for (index, sample) in samples.enumerated()
            where !sample.character.isWhitespace && !diagnostics.missing.contains(index) {
                available.insert(sample.character)
            }
        }
        var supported: [String] = []
        var details: [String: Any] = [:]
        for probe in probes {
            let result = probe.evaluate(id: id, supports: available)
            details[probe.language] = result.details
            if result.supported { supported.append(probe.language) }
        }
        return (supported, details)
    }

    func fonts() -> [[String: Any]] {
        if let fontList { return fontList }
        let collection = CTFontCollectionCreateFromAvailableFonts(nil)
        let descriptors = CTFontCollectionCreateMatchingFontDescriptors(collection) as? [CTFontDescriptor] ?? []
        var byName: [String: [CTFontDescriptor]] = [:]
        for descriptor in descriptors {
            guard let id = CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String else { continue }
            byName[id, default: []].append(descriptor)
        }

        var records: [[String: Any]] = []
        var identities: [URL: AnyHashable] = [:]
        for id in byName.keys.sorted() {
            guard let candidates = byName[id] else { continue }
            var files = Set<AnyHashable>()
            var candidatesByURL: [(CTFontDescriptor, URL?)] = []
            for descriptor in candidates {
                let url = origin(descriptor)
                if let url {
                    let identity = identities[url]
                        ?? ((try? url.resourceValues(forKeys: [.fileResourceIdentifierKey]))?.fileResourceIdentifier as? AnyHashable)
                        ?? AnyHashable(url)
                    identities[url] = identity
                    if !files.insert(identity).inserted { continue }
                }
                candidatesByURL.append((descriptor, url))
            }
            if candidatesByURL.count > 1 {
                // A PostScript name cannot distinguish conflicting installed files. Use the
                // same file CoreText resolves by name first, while reporting the conflict.
                let preferred = origin(CTFontCreateWithName(id as CFString, 12, nil))
                candidatesByURL.sort { a, b in
                    if a.1 == b.1 { return false }
                    if let preferred {
                        if a.1 == preferred { return true }
                        if b.1 == preferred { return false }
                    }
                    return (a.1?.path ?? "") < (b.1?.path ?? "")
                }
            }
            for (descriptor, url) in candidatesByURL {
                let font = CTFontCreateWithFontDescriptor(descriptor, 12, nil)
                guard CTFontCopyPostScriptName(font) as String == id,
                      url == nil || origin(font) == url else { continue }
                let axes = variation(font, descriptor: descriptor)
                faces[id] = Face(descriptor: descriptor, font: font, url: url, axes: axes)
                let category = kind(font)
                let classification = coverage(font: font, id: id, url: url)
                records.append([
                    "id": id,
                    "family": CTFontCopyFamilyName(font) as String,
                    "style": CTFontCopyName(font, kCTFontStyleNameKey) as String? ?? "",
                    "isSerif": category.serif,
                    "isSansSerif": category.sans,
                    "isMonospaced": CTFontGetSymbolicTraits(font).contains(.traitMonoSpace),
                    "supports": classification.supports,
                    "languages": classification.supports + (classification.supports.contains("numbers") ? ["digits"] : []),
                    "coverage": classification.details,
                    "duplicateCount": max(1, files.count),
                    "variable": axes.variable,
                    "variationIssue": axes.issue as Any? ?? NSNull()
                ])
                break
            }
        }
        fontList = records
        return records
    }

    func preview(_ request: [String: Any]) -> [String: Any] {
        let width = min(1400, max(1, (request["width"] as? NSNumber)?.intValue ?? 480))
        let scale = min(3, max(1, (request["scale"] as? NSNumber)?.doubleValue ?? 2))
        let fit = request["mode"] as? String == "fit"
        let minimumSize: CGFloat = fit ? 18 : 6
        var size = CGFloat(min(96, max(minimumSize, (request["size"] as? NSNumber)?.doubleValue ?? 32)))
        var result: [String: Any] = [
            "width": Int(ceil(Double(width) * scale)), "height": 0,
            "layoutWidth": width, "layoutHeight": 0, "fontSize": size,
            "mode": fit ? "fit" : "wrap", "lineCount": 0,
            "image": NSNull(), "png": NSNull(), "missing": [String](), "fallback": [String](),
            "fallbackBlocked": false, "loadError": NSNull(),
            "variationIssue": NSNull(), "actualPostscript": NSNull()
        ]
        _ = fonts()
        guard let id = request["id"] as? String, let face = faces[id] else {
            result["loadError"] = "这个字款在 macOS 中不可用。"
            return result
        }

        let text = String(((request["text"] as? String) ?? "").prefix(500))
        let paragraphs = paragraphs(in: text)
        let padding: CGFloat = 5
        let availableWidth = max(1, CGFloat(width) - 2 * padding)
        func faceAtSize(_ value: CGFloat) -> CTFont {
            CTFontCreateCopyWithAttributes(face.font, value, nil, nil)
        }
        var font = faceAtSize(size)
        func fits(_ candidate: CTFont) -> Bool {
            paragraphs.allSatisfy { paragraph in
                let line = CTLineCreateWithAttributedString(lineText(paragraph.text, font: candidate))
                return PreviewLine(line, offset: paragraph.offset, font: candidate).width <= availableWidth
            }
        }
        if fit && !fits(font) {
            // Use the largest size that fits each hard line. If even 18 does not
            // fit, retain 18 and let the same typesetter wrap it.
            size = minimumSize
            font = faceAtSize(size)
            if fits(font) {
                var low = Int(minimumSize) + 1
                var high = Int(min(96, (request["size"] as? NSNumber)?.doubleValue ?? 32))
                while low <= high {
                    let middle = (low + high) / 2
                    let candidate = faceAtSize(CGFloat(middle))
                    if fits(candidate) {
                        size = CGFloat(middle)
                        font = candidate
                        low = middle + 1
                    } else {
                        high = middle - 1
                    }
                }
            }
        }

        let actual = CTFontCopyPostScriptName(font) as String
        result["actualPostscript"] = actual
        result["fontSize"] = size
        guard actual == id, face.url == nil || origin(font) == face.url else {
            result["loadError"] = "CoreText 没有加载请求的字款。"
            return result
        }
        if let issue = face.axes.issue ?? (face.axes.variable ? variation(font, descriptor: face.descriptor).issue : nil) {
            result["variationIssue"] = issue
            return result
        }

        let lines = layout(paragraphs, font: font, width: availableWidth)
        let leading = max(2, CTFontGetLeading(font))
        // Pathological narrow widths may be smaller than even one grapheme.
        // Expand that image instead of cropping the glyph or changing its shape.
        let layoutWidth = max(CGFloat(width), ceil((lines.map(\.width).max() ?? 0) + 2 * padding))
        let layoutHeight = ceil(lines.reduce(2 * padding) { $0 + $1.ascent + $1.descent }
            + CGFloat(max(0, lines.count - 1)) * leading)
        // Long samples with hundreds of hard breaks still fit a bounded bitmap.
        // A lower raster resolution preserves the layout and every line.
        let rasterScale = min(scale, sqrt(12_000_000 / (layoutWidth * layoutHeight)),
                              30_000 / layoutWidth, 30_000 / layoutHeight)
        let pixelWidth = Int(ceil(layoutWidth * rasterScale))
        let pixelHeight = Int(ceil(layoutHeight * rasterScale))
        result["width"] = pixelWidth
        result["height"] = pixelHeight
        result["layoutWidth"] = layoutWidth
        result["layoutHeight"] = layoutHeight
        result["lineCount"] = lines.count
        result["rasterScale"] = rasterScale
        guard let context = CGContext(data: nil, width: pixelWidth, height: pixelHeight,
                                      bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            result["loadError"] = "无法创建预览图。"
            return result
        }
        context.scaleBy(x: rasterScale, y: rasterScale)
        context.textMatrix = .identity
        let characters = clusters(in: text)
        var top = layoutHeight - padding
        var diagnostics = Diagnostics()
        for line in lines {
            let baseline = top - line.ascent
            diagnostics.inspect(line.line, font: font, id: id, url: face.url, offset: line.offset, clusters: characters) { run, range in
                context.textPosition = CGPoint(x: padding + line.xOffset, y: baseline)
                CTRunDraw(run, context, range)
            }
            top = baseline - line.descent - leading
        }
        result["fallback"] = diagnostics.fallback.sorted()
        result["fallbackBlocked"] = diagnostics.fallbackBlocked
        var seen = Set<Character>()
        result["missing"] = diagnostics.missing.sorted().compactMap { index -> String? in
            let character = characters[index].character
            return seen.insert(character).inserted ? String(character) : nil
        }
        guard let image = context.makeImage(),
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            result["loadError"] = "无法编码预览图。"
            return result
        }
        let encoded = png.base64EncodedString()
        result["image"] = encoded
        result["png"] = encoded
        return result
    }
}

private let engine: FontEngine
do {
    engine = try FontEngine()
} catch {
    FileHandle.standardError.write(Data("Font Manage: could not load coverage.json: \(error.localizedDescription)\n".utf8))
    exit(2)
}
while let line = readLine() {
    autoreleasepool {
        let request = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
        var reply: [String: Any]
        switch request?["op"] as? String {
        case "fonts": reply = ["fonts": engine.fonts()]
        case "preview": reply = engine.preview(request!)
        default: reply = ["error": "未知的字体助手请求。"]
        }
        reply["seq"] = request?["seq"] ?? NSNull()
        if let data = try? JSONSerialization.data(withJSONObject: reply) {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([0x0A]))
        }
    }
}
