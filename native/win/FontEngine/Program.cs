// Font Manage Windows font engine — JSON Lines protocol compatible with native/FontEngine.swift.
// Renders with WPF GlyphTypeface only: no system font fallback can occur by construction.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

internal static class Program
{
    private static readonly string[] LanguageOrder = { "latin", "zh-Hans", "zh-Hant", "ja", "ko", "numbers", "symbols" };
    private static CoverageConfig Config;
    private static List<Face> Faces;
    private static readonly Dictionary<string, Face> ById = new Dictionary<string, Face>(StringComparer.OrdinalIgnoreCase);

    [STAThread]
    private static int Main()
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try { Config = CoverageConfig.Load(); }
        catch (Exception e) { Console.Error.WriteLine("font-engine: coverage.json load failed: " + e.Message); return 2; }
        Faces = FontCatalog.Enumerate(Config);
        foreach (var f in Faces) ById[f.Id] = f;
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            Dictionary<string, object> reply;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var req = doc.RootElement;
                var op = req.TryGetProperty("op", out var o) ? o.GetString() : "";
                reply = op switch
                {
                    "fonts" => CatalogReply(),
                    "preview" => PreviewSafe(req),
                    _ => new Dictionary<string, object> { ["error"] = "unknown op" }
                };
                if (req.TryGetProperty("seq", out var seq)) reply["seq"] = seq.ValueKind == JsonValueKind.Number ? seq.GetInt64() : seq.GetString();
            }
            catch (Exception e)
            {
                reply = new Dictionary<string, object> { ["error"] = e.Message };
            }
            Console.Out.WriteLine(JsonSerializer.Serialize(reply));
            Console.Out.Flush();
        }
        return 0;
    }

    private static Dictionary<string, object> PreviewSafe(JsonElement req)
    {
        try { return Preview.Reply(req, ById); }
        catch (Exception e)
        {
            var id = req.TryGetProperty("id", out var i) ? i.GetString() : "";
            return new Dictionary<string, object>
            {
                ["id"] = id, ["actualPostscript"] = id, ["png"] = null,
                ["missing"] = new List<string>(), ["fallback"] = new List<string>(),
                ["loadError"] = e.GetType().Name + ": " + e.Message
            };
        }
    }

    private static Dictionary<string, object> CatalogReply()
    {
        var list = new List<Dictionary<string, object>>();
        foreach (var f in Faces)
        {
            var coverage = new Dictionary<string, object>();
            var supports = new List<string>();
            foreach (var language in LanguageOrder)
            {
                var result = CoverageProbe.Evaluate(Config, language, f);
                coverage[language] = result.Details;
                if (result.Supported) supports.Add(language);
            }
            list.Add(new Dictionary<string, object>
            {
                ["id"] = f.Id,
                ["family"] = f.Family,
                ["style"] = f.Style,
                ["isSerif"] = f.IsSerif,
                ["isSansSerif"] = f.IsSansSerif,
                ["isMonospaced"] = f.IsMonospaced,
                ["languages"] = supports,
                ["coverage"] = coverage,
                ["duplicateCount"] = f.DuplicateCount,
                ["origin"] = f.Origin ?? ""
            });
        }
        return new Dictionary<string, object> { ["fonts"] = list, ["count"] = list.Count };
    }
}

internal sealed class CoverageRule
{
    public int[] Core;
    public int[] Common;
    public double MinCore;
    public double MinOverall;
    public string RequiredScript;
}

internal sealed class CoverageConfig
{
    public HashSet<string> ExcludePostScript = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, CoverageRule> Languages = new Dictionary<string, CoverageRule>();

    public static CoverageConfig Load()
    {
        var candidates = new[]
        {
            Path.Combine(Directory.GetCurrentDirectory(), "config", "coverage.json"),
            Path.Combine(AppContext.BaseDirectory, "config", "coverage.json"),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "config", "coverage.json"))
        };
        var path = candidates.FirstOrDefault(File.Exists) ?? throw new FileNotFoundException("coverage.json not found");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var config = new CoverageConfig();
        if (doc.RootElement.TryGetProperty("excludePostScript", out var ex))
            foreach (var item in ex.EnumerateArray()) config.ExcludePostScript.Add(item.GetString());
        foreach (var language in doc.RootElement.GetProperty("languages").EnumerateObject())
        {
            var rule = new CoverageRule();
            rule.Core = Runes(language.Value.GetProperty("core").GetString());
            rule.Common = Runes(language.Value.GetProperty("common").GetString());
            rule.MinCore = language.Value.TryGetProperty("minCore", out var mc) ? mc.GetDouble() : 1;
            rule.MinOverall = language.Value.TryGetProperty("minOverall", out var mo) ? mo.GetDouble() : 1;
            rule.RequiredScript = language.Value.TryGetProperty("requiredScript", out var rs) ? rs.GetString() : null;
            config.Languages[language.Name] = rule;
        }
        return config;
    }

    internal static int[] Runes(string text) =>
        string.IsNullOrEmpty(text) ? Array.Empty<int>() : text.EnumerateRunes().Select(r => r.Value).ToArray();
}

internal sealed class Face
{
    public string Id;
    public string Family;
    public string Style;
    public bool IsSerif;
    public bool IsSansSerif;
    public bool IsMonospaced;
    public int DuplicateCount = 1;
    public string Origin;
    public GlyphTypeface Glyph;
    public double LineSpacing;
    public double Baseline;
    public Dictionary<int, int> CharToGlyph;
}

internal static class FontCatalog
{
    public static List<Face> Enumerate(CoverageConfig config)
    {
        var faces = new List<Face>();
        foreach (var family in Fonts.SystemFontFamilies)
        {
            string familyName;
            try { familyName = family.Source; } catch { continue; }
            double familyLineSpacing;
            double familyBaseline;
            try { familyLineSpacing = family.LineSpacing; familyBaseline = family.Baseline; } catch { familyLineSpacing = 1.2; familyBaseline = 0.8; }
            System.Collections.Generic.IEnumerable<Typeface> typefaces;
            try { typefaces = family.GetTypefaces(); } catch { continue; }
            foreach (var typeface in typefaces)
            {
                GlyphTypeface glyph;
                try { if (!typeface.TryGetGlyphTypeface(out glyph) || glyph == null) continue; } catch { continue; }
                var origin = glyph.FontUri?.LocalPath;
                if (origin == null || !File.Exists(origin)) continue;
                var id = NameTable.PostScriptName(origin) ?? Path.GetFileNameWithoutExtension(origin);
                if (string.IsNullOrEmpty(id)) continue;
                string style;
                try { style = typeface.FaceNames.Values.FirstOrDefault() ?? ""; } catch { style = ""; }
                var name = (familyName + " " + style).ToLowerInvariant();
                var face = new Face
                {
                    Id = id,
                    Family = familyName,
                    Style = style,
                    Origin = origin,
                    Glyph = glyph,
                    LineSpacing = familyLineSpacing,
                    Baseline = familyBaseline,
                    CharToGlyph = glyph.CharacterToGlyphMap.ToDictionary(kv => kv.Key, kv => (int)kv.Value),
                    IsMonospaced = name.Contains("mono") || name.Contains("consolas") || name.Contains("courier") || name.Contains("code"),
                    IsSerif = name.Contains("serif") && !name.Contains("sans"),
                    IsSansSerif = !name.Contains("serif") || name.Contains("sans")
                };
                if (config.ExcludePostScript.Contains(id)) face.IsSansSerif = false;
                faces.Add(face);
            }
        }
        var groups = faces.GroupBy(f => f.Id, StringComparer.OrdinalIgnoreCase);
        var result = new List<Face>();
        foreach (var group in groups)
        {
            var ordered = group.OrderBy(f => f.Origin, StringComparer.OrdinalIgnoreCase).ToList();
            ordered[0].DuplicateCount = ordered.Count;
            result.Add(ordered[0]);
        }
        result.Sort((a, b) => string.CompareOrdinal((a.Family + a.Style + a.Id).ToLowerInvariant(), (b.Family + b.Style + b.Id).ToLowerInvariant()));
        return result;
    }
}

internal static class NameTable
{
    // Minimal sfnt parser: returns name ID 6 (PostScript name), platform 3/1 preferred.
    public static string PostScriptName(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var br = new BinaryReader(fs);
            uint tag = ReadU32(br);
            if (tag != 0x00010000 && tag != 0x4F54544F && tag != 0x74727565) return null; // 1.0, OTTO, true
            ushort numTables = ReadU16(br);
            br.ReadBytes(6);
            long nameOffset = -1;
            for (int i = 0; i < numTables; i++)
            {
                uint t = ReadU32(br); ReadU32(br); uint offset = ReadU32(br); ReadU32(br);
                if (t == 0x6E616D65) { nameOffset = offset; break; }
            }
            if (nameOffset < 0) return null;
            fs.Position = nameOffset;
            ReadU16(br);
            int count = ReadU16(br), storageOffset = ReadU16(br);
            string fallback = null;
            for (int i = 0; i < count; i++)
            {
                int platform = ReadU16(br), encoding = ReadU16(br), lang = ReadU16(br), nameId = ReadU16(br), length = ReadU16(br), offset = ReadU16(br);
                if (nameId != 6) continue;
                long record = fs.Position;
                fs.Position = nameOffset + storageOffset + offset;
                var bytes = br.ReadBytes(length);
                fs.Position = record;
                string value = platform == 3 ? Encoding.BigEndianUnicode.GetString(bytes) : Encoding.ASCII.GetString(bytes);
                value = value.Trim('\0', ' ');
                if (platform == 3) return value;
                fallback ??= value;
            }
            return fallback;
        }
        catch { return null; }
    }

    private static ushort ReadU16(BinaryReader br) { var b = br.ReadBytes(2); return (ushort)((b[0] << 8) | b[1]); }
    private static uint ReadU32(BinaryReader br) { var b = br.ReadBytes(4); return ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | b[3]; }
}

internal static class CoverageProbe
{
    public sealed class Result
    {
        public bool Supported;
        public Dictionary<string, object> Details = new Dictionary<string, object>();
    }

    public static Result Evaluate(CoverageConfig config, string language, Face face)
    {
        var rule = config.Languages[language];
        bool excluded = config.ExcludePostScript.Contains(face.Id);
        int matchedCore = rule.Core.Count(c => face.CharToGlyph.ContainsKey(c));
        int matchedCommon = rule.Common.Count(c => face.CharToGlyph.ContainsKey(c));
        double coreRatio = rule.Core.Length == 0 ? 1 : (double)matchedCore / rule.Core.Length;
        int total = rule.Core.Length + rule.Common.Length;
        int matched = matchedCore + matchedCommon;
        double ratio = total == 0 ? 1 : (double)matched / total;
        var missingCore = rule.Core.Where(c => !face.CharToGlyph.ContainsKey(c)).Select(c => char.ConvertFromUtf32(c)).ToList();
        var missing = rule.Core.Concat(rule.Common).Where(c => !face.CharToGlyph.ContainsKey(c)).Select(c => char.ConvertFromUtf32(c)).ToList();
        string reason;
        if (excluded) reason = "excluded-font";
        else if (matchedCore == 0) reason = "no-coverage";
        else if (coreRatio < rule.MinCore) reason = "below-core-threshold";
        else if (rule.RequiredScript == "kana" && !HasScript(face, 0x3040, 0x30FF)) reason = "required-script-missing";
        else if (rule.RequiredScript == "hangul" && !HasScript(face, 0xAC00, 0xD7AF)) reason = "required-script-missing";
        else if (ratio < rule.MinOverall) reason = "partial-coverage";
        else reason = "supported";
        bool supported = reason == "supported" || reason == "partial-coverage";
        return new Result
        {
            Supported = supported,
            Details = new Dictionary<string, object>
            {
                ["supported"] = supported,
                ["ratio"] = Math.Round(ratio, 4),
                ["coreRatio"] = Math.Round(coreRatio, 4),
                ["reason"] = reason,
                ["missingCore"] = missingCore,
                ["missing"] = missing
            }
        };
    }

    private static bool HasScript(Face face, int start, int end) =>
        face.CharToGlyph.Keys.Any(c => c >= start && c <= end);
}

internal static class Preview
{
    private sealed class GlyphItem { public int CodePoint; public ushort Glyph; public double Advance; public string Text; }
    private sealed class Line { public List<GlyphItem> Items = new List<GlyphItem>(); public double Width; public double Size; public List<GlyphItem> Missing = new List<GlyphItem>(); }

    public static Dictionary<string, object> Reply(JsonElement req, Dictionary<string, Face> byId)
    {
        var id = req.TryGetProperty("id", out var i) ? i.GetString() : "";
        var result = new Dictionary<string, object>
        {
            ["id"] = id, ["actualPostscript"] = id, ["png"] = null, ["width"] = 0, ["height"] = 0,
            ["layoutWidth"] = 0, ["layoutHeight"] = 0, ["lineCount"] = 0, ["actualSize"] = 0,
            ["missing"] = new List<string>(), ["fallback"] = new List<string>(), ["loadError"] = null, ["mode"] = "wrap"
        };
        if (!byId.TryGetValue(id, out var face)) { result["loadError"] = "font not found"; return result; }
        string text = req.TryGetProperty("text", out var t) ? t.GetString() ?? "" : "";
        double size = req.TryGetProperty("size", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetDouble() : 28;
        double width = req.TryGetProperty("width", out var w) && w.ValueKind == JsonValueKind.Number ? w.GetDouble() : 360;
        double scale = req.TryGetProperty("scale", out var sc) && sc.ValueKind == JsonValueKind.Number ? sc.GetDouble() : 2;
        string mode = req.TryGetProperty("mode", out var m) ? m.GetString() : "wrap";
        bool fit = mode == "fit";
        result["mode"] = fit ? "fit" : "wrap";
        var glyph = face.Glyph;
        double lineHeight = face.LineSpacing <= 0 ? 1.2 : face.LineSpacing;

        var paragraphs = (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var allMissing = new List<string>();

        List<GlyphItem> Measure(string paragraph, double fontSize)
        {
            var items = new List<GlyphItem>();
            foreach (var rune in paragraph.EnumerateRunes())
            {
                var item = new GlyphItem { CodePoint = rune.Value, Text = rune.ToString(), Glyph = 0, Advance = 0 };
                if (face.CharToGlyph.TryGetValue(rune.Value, out var g) && g != 0)
                {
                    item.Glyph = (ushort)g;
                    item.Advance = glyph.AdvanceWidths[(ushort)g] * fontSize;
                }
                items.Add(item);
            }
            return items;
        }

        var lines = new List<Line>();
        double usedSize = size;
        foreach (var paragraph in paragraphs)
        {
            if (fit)
            {
                var items = Measure(paragraph, size);
                double lineWidth = items.Sum(it => it.Advance);
                if (lineWidth <= width || items.Count == 0)
                {
                    lines.Add(new Line { Items = items, Width = lineWidth, Size = size });
                    continue;
                }
                // Largest size >= 18 whose single line fits; otherwise 18 and wrap.
                double lo = 18, hi = size, best = 18;
                for (int step = 0; step < 18; step++)
                {
                    double mid = (lo + hi) / 2;
                    if (Measure(paragraph, mid).Sum(it => it.Advance) <= width) { best = mid; lo = mid; } else hi = mid;
                }
                if (Measure(paragraph, best).Sum(it => it.Advance) <= width)
                {
                    lines.Add(new Line { Items = Measure(paragraph, best), Width = Measure(paragraph, best).Sum(it => it.Advance), Size = best });
                    continue;
                }
                usedSize = 18;
            }
            // Wrap by words where possible, otherwise by character.
            var chars = Measure(paragraph, usedSize);
            var current = new Line { Size = usedSize };
            var word = new List<GlyphItem>();
            bool Breakable(GlyphItem it) => it.Text == " " || it.CodePoint >= 0x2E80;
            void FlushWord()
            {
                foreach (var it in word)
                {
                    if (current.Width + it.Advance > width && current.Items.Count > 0) { lines.Add(current); current = new Line { Size = usedSize }; }
                    current.Items.Add(it); current.Width += it.Advance;
                }
                word.Clear();
            }
            foreach (var it in chars)
            {
                if (it.Text == " ") { FlushWord(); current.Items.Add(it); current.Width += it.Advance; continue; }
                if (Breakable(it)) { FlushWord(); if (current.Width + it.Advance > width && current.Items.Count > 0) { lines.Add(current); current = new Line { Size = usedSize }; } current.Items.Add(it); current.Width += it.Advance; continue; }
                word.Add(it);
            }
            FlushWord();
            if (current.Items.Count > 0 || chars.Count == 0) lines.Add(current);
        }

        double layoutWidth = Math.Max(1, lines.Count == 0 ? width : lines.Max(l => Math.Max(l.Width, 1)));
        double layoutHeight = Math.Max(1, lines.Sum(l => l.Size * lineHeight));
        double rasterScale = Math.Min(scale, Math.Sqrt(12000000.0 / (layoutWidth * layoutHeight)));
        rasterScale = Math.Max(0.05, rasterScale);
        int pixelWidth = Math.Max(1, (int)Math.Ceiling(layoutWidth * rasterScale));
        int pixelHeight = Math.Max(1, (int)Math.Ceiling(layoutHeight * rasterScale));

        var visual = new DrawingVisual();
        using (var dc = visual.RenderOpen())
        {
            double y = 0;
            foreach (var line in lines)
            {
                double x = 0;
                var brush = new SolidColorBrush(Color.FromRgb(0xEE, 0xEE, 0xEF));
                foreach (var it in line.Items)
                {
                    if (it.Glyph == 0) { allMissing.Add(it.Text); x += 0; continue; }
                    var run = new GlyphRun(
                        glyph,
                        0,
                        false,
                        line.Size,
                        1.0f,
                        new ushort[] { it.Glyph },
                        new Point(x, y + line.Size * face.Baseline),
                        new double[] { it.Advance },
                        null, null, null, null, null, null);
                    dc.DrawGlyphRun(brush, run);
                    x += it.Advance;
                }
                y += line.Size * lineHeight;
            }
        }
        var bitmap = new RenderTargetBitmap(pixelWidth, pixelHeight, 96 * rasterScale, 96 * rasterScale, PixelFormats.Pbgra32);
        visual.Transform = new ScaleTransform(rasterScale, rasterScale);
        bitmap.Render(visual);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var ms = new MemoryStream();
        encoder.Save(ms);

        result["png"] = Convert.ToBase64String(ms.ToArray());
        result["width"] = pixelWidth;
        result["height"] = pixelHeight;
        result["layoutWidth"] = layoutWidth;
        result["layoutHeight"] = layoutHeight;
        result["lineCount"] = lines.Count;
        result["actualSize"] = lines.Count > 0 ? lines[0].Size : usedSize;
        result["missing"] = allMissing.Distinct().ToList();
        result["rasterScale"] = rasterScale;
        return result;
    }
}
