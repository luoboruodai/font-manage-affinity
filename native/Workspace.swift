import AppKit
import WebKit

private func workspaceURL(_ argument: String) -> URL? {
    guard let url = URL(string: argument), url.scheme == "http", url.host == "127.0.0.1",
          let port = url.port, (1...65535).contains(port),
          url.user == nil, url.password == nil else { return nil }
    return url
}

private final class Workspace: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private let url: URL
    private var window: NSWindow?
    private var web: WKWebView?
    private var closing = false

    init(url: URL) {
        self.url = url
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let background = NSColor(srgbRed: 0.073, green: 0.073, blue: 0.083, alpha: 1)
        NSApp.appearance = NSAppearance(named: .darkAqua)
        NSApp.mainMenu = makeMenu()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 780),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Font Manage"
        window.contentMinSize = NSSize(width: 380, height: 520)
        window.backgroundColor = background
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.setFrameAutosaveName("FontManageWorkspace")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "close")
        configuration.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 520, height: 780), configuration: configuration)
        if #available(macOS 12, *) { web.underPageBackgroundColor = background }
        web.navigationDelegate = self
        self.web = web
        window.contentView = web
        self.window = window
        if !window.setFrameUsingName("FontManageWorkspace") { window.center() }
        window.makeKeyAndOrderFront(nil)
        if #available(macOS 14, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
        web.load(URLRequest(url: url))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "close" { closing = true; NSApp.terminate(nil) }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closing { return true }
        requestClose()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if closing { return .terminateNow }
        requestClose()
        return .terminateCancel
    }

    private func requestClose() {
        web?.evaluateJavaScript("typeof window.fontManageClose === 'function' ? (window.fontManageClose(), true) : false") { result, error in
            if error != nil || (result as? Bool) != true { self.closing = true; NSApp.terminate(nil) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let next = navigationAction.request.url,
              let local = workspaceURL(next.absoluteString), local.port == url.port,
              navigationAction.targetFrame?.isMainFrame == true else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        let alert = NSAlert()
        alert.messageText = "无法打开 Font Manage"
        alert.informativeText = "本地字体管理服务没有响应。"
        alert.addButton(withTitle: "关闭")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        let app = NSMenuItem()
        app.submenu = NSMenu(title: "Font Manage")
        app.submenu?.addItem(withTitle: "退出 Font Manage", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(app)

        let file = NSMenuItem()
        file.submenu = NSMenu(title: "文件")
        file.submenu?.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        menu.addItem(file)

        let edit = NSMenuItem()
        let items = NSMenu(title: "编辑")
        items.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = items.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        items.addItem(.separator())
        items.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        items.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        items.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        items.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = items
        menu.addItem(edit)
        return menu
    }
}

guard CommandLine.arguments.count == 2, let url = workspaceURL(CommandLine.arguments[1]) else {
    FileHandle.standardError.write(Data("用法：font-workspace http://127.0.0.1:PORT\n".utf8))
    exit(2)
}
let app = NSApplication.shared
private let workspace = Workspace(url: url)
app.setActivationPolicy(.regular)
app.delegate = workspace
app.run()
