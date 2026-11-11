import AppKit
import WebKit

let accent = NSColor(calibratedRed: 0.89, green: 0.62, blue: 0.32, alpha: 1)
let ink = NSColor(calibratedRed: 0.072, green: 0.072, blue: 0.064, alpha: 1)
let testing = CommandLine.arguments.contains("--ui-check")
let preview = Bundle.main.bundleIdentifier == "studio.blackmamba.workbench.ring-preview"
let port = testing ? 18773 : (preview ? 18774 : 18771)
let base = URL(string: "http://127.0.0.1:\(port)/")!
let isolated = testing || preview
let runMarker = isolated ? UUID().uuidString : nil
let prefs = testing ? UserDefaults(suiteName: "studio.blackmamba.ui-check")! : UserDefaults.standard

// Portable releases resolve their runtime inside the bundle and data for the current user.
func runtimePaths(_ resources: URL) throws -> (node: URL, data: String) {
    let config = try JSONDecoder().decode([String:String].self, from:Data(contentsOf:resources.appendingPathComponent("runtime.json")))
    let portable = config["portable"] == "true"
    let node = portable ? resources.appendingPathComponent("runtime/node") : URL(fileURLWithPath:config["node"] ?? "")
    let folder = portable ? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("Black Mamba Workbench/workspace").path : config["data"]
    guard let data = testing ? ProcessInfo.processInfo.environment["MAMBA_TEST_DIR"] : folder, !data.isEmpty,
          portable || !(config["node"] ?? "").isEmpty else { throw CocoaError(.fileReadCorruptFile) }
    return (node,data)
}

func fit(_ point: NSPoint, size: NSSize, in frame: NSRect) -> NSPoint {
    NSPoint(x: max(frame.minX, min(point.x, frame.maxX - size.width)),
            y: max(frame.minY, min(point.y, frame.maxY - size.height)))
}

final class Desk: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, URLSessionTaskDelegate {
    let main = NSWindow(contentRect:NSRect(x:0,y:0,width:1160,height:760),styleMask:[.titled,.closable,.resizable,.miniaturizable],backing:.buffered,defer:false)
    let orb = NSPanel(contentRect:NSRect(x:0,y:0,width:82,height:82),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
    let panel = StatusPanel(contentRect:NSRect(x:0,y:0,width:320,height:176),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
    let ring = Ring(), status = NSTextField(labelWithString:"正在检查本机服务…")
    let reading = NSTextField(labelWithString:"正在检查"), checkedAt = NSTextField(labelWithString:"")
    lazy var enter = button("打开工作台",#selector(showMain))
    lazy var refresh = button("重新检查",#selector(retry))
    lazy var dismiss = button("收起",#selector(hidePanel))
    let assistant = NSPanel(contentRect:NSRect(x:0,y:0,width:420,height:250),styleMask:[.titled,.closable,.utilityWindow],backing:.buffered,defer:false)
    let message = NSTextField(labelWithString:"制片助手 · 指令草稿")
    let draft = NSTextField(), help = NSTextField(wrappingLabelWithString:"复制草稿后，可粘贴到 Codex 中的制片助手会话。")
    var voiceURL: URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier:"com.openai.codex") }
    var state = ServiceState.checking
    let timeFormat: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; return f }()
    let web: WKWebView
    var child: Process?, timer: Timer?, checking = false, online = false, attempted = false
    var screenObserver: NSObjectProtocol?

    override init() {
        let conf = WKWebViewConfiguration(); conf.applicationNameForUserAgent = "MambaDesktop"
        conf.mediaTypesRequiringUserActionForPlayback = [] // User-requested local hover previews, including audio.
        if testing { conf.websiteDataStore = .nonPersistent() }
        web = WKWebView(frame:.zero, configuration:conf)
        super.init()
    }
    func button(_ title: String, _ action: Selector) -> NSButton { NSButton(title:title,target:self,action:action) }
    func menuItem(_ menu:NSMenu, _ title:String, _ action:Selector, _ key:String) {
        let item = menu.addItem(withTitle:title,action:action,keyEquivalent:key); item.target = self
    }
    func applicationDidFinishLaunching(_ note:Notification) {
        NSApp.appearance = NSAppearance(named:.darkAqua)
        let menu = NSMenu(), top = NSMenuItem(), actions = NSMenu()
        menu.addItem(top); top.submenu = actions; NSApp.mainMenu = menu
        menuItem(actions,"打开工作台",#selector(showMain),"1")
        menuItem(actions,"制片助手草稿",#selector(showAssistant),"")
        menuItem(actions,"桌面状态",#selector(showPanel),"2")
        menuItem(actions,"关闭窗口",#selector(closeKey),"w")
        menuItem(actions,"显示本机 MCP 启动器",#selector(revealMCP),"")
        menuItem(actions,"退出黑曼巴",#selector(quit),"q")
        let edit = NSMenuItem(title:"编辑",action:nil,keyEquivalent:""); menu.addItem(edit)
        let edits = NSMenu(title:"编辑"); edit.submenu = edits
        for (name,selector,key) in [("撤销","undo:","z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")] {
            edits.addItem(withTitle:name,action:NSSelectorFromString(selector),keyEquivalent:key)
        }
        main.collectionBehavior.insert(.fullScreenPrimary)
        let viewMenu = NSMenu(title:"窗口")
        let viewItem = NSMenuItem(title:"窗口",action:nil,keyEquivalent:"")
        menu.addItem(viewItem); viewItem.submenu = viewMenu
        menuItem(viewMenu,"紧凑窗口",#selector(compactWindow),"")
        menuItem(viewMenu,"标准窗口",#selector(standardWindow),"")
        let full = viewMenu.addItem(withTitle:"切换全屏",action:#selector(NSWindow.toggleFullScreen(_:)),keyEquivalent:"f")
        full.target = main; full.keyEquivalentModifierMask = [.control,.command]
        main.title = "黑曼巴工作台"; main.isReleasedWhenClosed = false; main.minSize = NSSize(width:610,height:430)
        main.center(); if !testing { main.setFrameAutosaveName(preview ? "MambaPreviewMain" : "MambaMain") }
        web.navigationDelegate = self; web.uiDelegate = self
        let bar = NSStackView(views:[status, button("重新检查",#selector(retry)),button("原浏览器项目",#selector(browser)),button("制片助手草稿",#selector(showAssistant)),button("桌面状态",#selector(showPanel))])
        bar.spacing = 12; bar.edgeInsets = NSEdgeInsets(top:8,left:14,bottom:8,right:14)
        let root = NSView(); main.contentView = root
        for v in [bar as NSView, web as NSView] { root.addSubview(v); v.translatesAutoresizingMaskIntoConstraints = false }
        NSLayoutConstraint.activate([bar.leadingAnchor.constraint(equalTo:root.leadingAnchor),bar.topAnchor.constraint(equalTo:root.topAnchor),bar.trailingAnchor.constraint(lessThanOrEqualTo:root.trailingAnchor),web.topAnchor.constraint(equalTo:bar.bottomAnchor),web.leadingAnchor.constraint(equalTo:root.leadingAnchor),web.trailingAnchor.constraint(equalTo:root.trailingAnchor),web.bottomAnchor.constraint(equalTo:root.bottomAnchor)])
        setupPanel()
        assistant.title = "召唤制片助手"; assistant.isReleasedWhenClosed = false; assistant.level = .floating; assistant.hidesOnDeactivate = false
        draft.placeholderString = "给制片助手的指令草稿"; draft.setAccessibilityLabel("指令草稿")
        message.font = .systemFont(ofSize:20,weight:.semibold); message.textColor = accent
        help.preferredMaxLayoutWidth = 375
        let buttons = NSStackView(views:[button("复制草稿",#selector(copyDraft)),button("打开 Codex",#selector(openOfficial)),button("工作台",#selector(showMain))])
        let fields = NSStackView(views:[message,help,draft,buttons]); fields.orientation = .vertical; fields.alignment = .leading; fields.spacing = 16
        assistant.contentView!.addSubview(fields); fields.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([fields.leadingAnchor.constraint(equalTo:assistant.contentView!.leadingAnchor,constant:20), fields.trailingAnchor.constraint(equalTo:assistant.contentView!.trailingAnchor,constant:-20),fields.centerYAnchor.constraint(equalTo:assistant.contentView!.centerYAnchor),draft.widthAnchor.constraint(equalTo:fields.widthAnchor)])

        orb.backgroundColor = .clear; orb.isOpaque = false; orb.level = .floating; orb.hidesOnDeactivate = false
        orb.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]; orb.contentView = ring
        ring.setAccessibilityElement(true); ring.setAccessibilityRole(.button); ring.setAccessibilityLabel("打开黑曼巴工作台")
        ring.activate = { [weak self] in self?.showMain() }
        ring.moved = { [weak self] in
            self?.saveOrb()
            if self?.panel.isVisible == true { self?.placePanel() }
        }
        restoreOrb(); screenObserver = NotificationCenter.default.addObserver(forName:NSApplication.didChangeScreenParametersNotification,object:nil,queue:.main) { [weak self] _ in
            self?.restoreOrb()
            if self?.panel.isVisible == true { self?.placePanel() }
        }
        render(.checking); orb.orderFrontRegardless(); probe()
        timer = Timer.scheduledTimer(withTimeInterval:3,repeats:true) { [weak self] _ in self?.probe() }
        if testing { runChecks() } else if !preview { showMain() }
    }
    @objc func showAssistant() {
        if !assistant.isVisible { assistant.center() }
        NSApp.activate(ignoringOtherApps:true); assistant.makeKeyAndOrderFront(nil);assistant.makeFirstResponder(draft)
    }
    @objc func copyDraft() {
        guard !draft.stringValue.isEmpty else { assistant.makeFirstResponder(draft); return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(draft.stringValue,forType:.string)
    }
    func launchChatGPT(completion:@escaping(Bool)->Void) {
        guard let url = voiceURL else { completion(false); return }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = !testing
        NSWorkspace.shared.openApplication(at:url, configuration:config) { app,error in
            DispatchQueue.main.async { completion(app != nil && error == nil) }
        }
    }
    @objc func openOfficial() {
        launchChatGPT { ok in
            if !ok { self.help.stringValue = "Codex 打开失败，请从 Dock 进入制片助手会话。" }
        }
    }
    func setupPanel() {
        panel.title = "黑曼巴桌面状态"; panel.isReleasedWhenClosed = false; panel.level = .floating
        panel.hidesOnDeactivate = false; panel.isOpaque = false; panel.backgroundColor = .clear
        panel.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]
        let card = NSView(); card.wantsLayer = true
        card.layer?.backgroundColor = ink.cgColor; card.layer?.cornerRadius = 18
        card.layer?.borderWidth = 1; card.layer?.borderColor = accent.withAlphaComponent(0.32).cgColor
        panel.contentView = card
        let title = NSTextField(labelWithString: preview ? "黑曼巴 · 预览" : "黑曼巴")
        title.font = .systemFont(ofSize:21, weight:.semibold)
        dismiss.image = NSImage(systemSymbolName:"xmark",accessibilityDescription:"收起桌面状态")
        dismiss.imagePosition = .imageOnly; dismiss.bezelStyle = .inline; dismiss.toolTip = "收起（Esc）"
        dismiss.setAccessibilityLabel("收起桌面状态")
        let service = NSTextField(labelWithString:"本机服务")
        service.font = .systemFont(ofSize:14,weight:.medium)
        reading.font = .systemFont(ofSize:14,weight:.semibold)
        checkedAt.font = .monospacedDigitSystemFont(ofSize:12,weight:.regular); checkedAt.textColor = .lightGray
        let rule = NSBox(); rule.boxType = .separator
        enter.bezelStyle = .rounded; enter.bezelColor = NSColor(calibratedRed:0.38,green:0.24,blue:0.12,alpha:1)
        refresh.bezelStyle = .rounded
        for v in [title,dismiss,rule,service,reading,checkedAt,enter,refresh] as [NSView] {
            card.addSubview(v); v.translatesAutoresizingMaskIntoConstraints = false
        }
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo:card.leadingAnchor,constant:20), title.topAnchor.constraint(equalTo:card.topAnchor,constant:16),
            dismiss.trailingAnchor.constraint(equalTo:card.trailingAnchor,constant:-12), dismiss.centerYAnchor.constraint(equalTo:title.centerYAnchor),
            dismiss.widthAnchor.constraint(equalToConstant:30), dismiss.heightAnchor.constraint(equalToConstant:28),
            rule.leadingAnchor.constraint(equalTo:title.leadingAnchor), rule.trailingAnchor.constraint(equalTo:card.trailingAnchor,constant:-20),
            rule.topAnchor.constraint(equalTo:title.bottomAnchor,constant:12),
            service.leadingAnchor.constraint(equalTo:title.leadingAnchor), service.topAnchor.constraint(equalTo:rule.bottomAnchor,constant:14),
            reading.trailingAnchor.constraint(equalTo:rule.trailingAnchor), reading.firstBaselineAnchor.constraint(equalTo:service.firstBaselineAnchor),
            checkedAt.leadingAnchor.constraint(equalTo:service.leadingAnchor), checkedAt.topAnchor.constraint(equalTo:service.bottomAnchor,constant:4),
            enter.leadingAnchor.constraint(equalTo:title.leadingAnchor), enter.bottomAnchor.constraint(equalTo:card.bottomAnchor,constant:-16),
            refresh.trailingAnchor.constraint(equalTo:rule.trailingAnchor), refresh.centerYAnchor.constraint(equalTo:enter.centerYAnchor)
        ])
        panel.dismissPanel = { [weak self] in self?.hidePanel() }; panel.actions = [enter,refresh,dismiss]; panel.initialFirstResponder = enter; enter.nextKeyView = refresh; refresh.nextKeyView = dismiss; dismiss.nextKeyView = enter
    }

    func render(_ value: ServiceState, detail: String? = nil) {
        state = value; ring.state = value; reading.stringValue = value.title; reading.textColor = value.color
        if Date() >= linkResultUntil { status.stringValue = "本机服务 · " + value.title }
        checkedAt.stringValue = detail ?? (value == .checking ? "正在读取本机状态…" : "最近检查  " + timeFormat.string(from:Date()))
        ring.toolTip = "本机服务" + value.title + " · 点按查看，拖动移动"
        ring.setAccessibilityValue(value.title)
        refresh.isEnabled = value != .checking
    }
    var linkResultUntil=Date.distantPast
    func showLinkResult(_ text:String) { linkResultUntil=Date().addingTimeInterval(12); status.stringValue=text }
    func saveOrb() { prefs.set(NSStringFromPoint(orb.frame.origin),forKey:"ringPosition") }
    func restoreOrb() {
        guard let primary = NSScreen.main else { return }
        let saved = prefs.string(forKey:"ringPosition").map(NSPointFromString) ?? NSPoint(x:primary.visibleFrame.maxX-106,y:primary.visibleFrame.midY - (preview ? 100 : 0))
        let screen = NSScreen.screens.first { $0.visibleFrame.contains(saved) } ?? primary
        orb.setFrameOrigin(fit(saved,size:orb.frame.size,in:screen.visibleFrame))
    }
    @objc func retry() { attempted = false; render(.checking); probe() }
    lazy var healthSession = URLSession(configuration:.ephemeral,delegate:self,delegateQueue:nil)
    func urlSession(_ session:URLSession, task:URLSessionTask, willPerformHTTPRedirection response:HTTPURLResponse, newRequest request:URLRequest, completionHandler:@escaping(URLRequest?)->Void) {
        completionHandler(nil)
    }
    func probe() {
        guard !checking else { return }; checking = true
        var request = URLRequest(url:base.appendingPathComponent("health")); request.timeoutInterval = 1.5; request.cachePolicy = .reloadIgnoringLocalCacheData
        healthSession.dataTask(with:request) { data,response,error in
            let body = data.flatMap { try? JSONSerialization.jsonObject(with:$0) as? [String:Any] }
            let ok = (response as? HTTPURLResponse)?.statusCode == 200 && body?["app"] as? String == "blackmamba-local" && body?["mode"] as? String == "local" && (runMarker == nil || body?["instance"] as? String == runMarker)
            DispatchQueue.main.async {
                self.checking = false
                if ok && self.main.isVisible && self.web.url == nil && !self.web.isLoading { self.web.load(URLRequest(url:base)) }
                self.online = ok
                self.render(ok ? .ready : .offline, detail: ok ? nil : (response == nil ? "服务暂不可用，可重新检查" : "端口响应与此工作台不匹配"))
                if !ok && !self.attempted && response == nil && (error as? URLError)?.code == .cannotConnectToHost {
                    self.attempted = true; self.startServer()
                }
            }
        }.resume()
    }
    func startServer() {
        guard child?.isRunning != true, let resources = Bundle.main.resourceURL else { return }
        do {
            let runtime = try runtimePaths(resources)
            let p = Process(); p.executableURL = runtime.node; p.arguments = [resources.appendingPathComponent("server.mjs").path]
            p.environment = ["MAMBA_PORT":String(base.port!),"MAMBA_DATA_DIR":runtime.data]
            for key in ["PATH", "HOME", "TMPDIR", "MAMBA_CODEX_BIN", "MAMBA_REMOTION_CLI", "MAMBA_CHROME", "MAMBA_FFMPEG", "MAMBA_FFPROBE", "MAMBA_PYTHON3", "RESOLVE_SCRIPT_API"] {
                if let value = ProcessInfo.processInfo.environment[key] { p.environment?[key] = value }
            }
            for (key, value) in ProcessInfo.processInfo.environment where key.hasPrefix("MAMBA_MCP_") {
                p.environment?[key] = value
            }
            if let marker = runMarker { p.environment?["MAMBA_INSTANCE"] = marker }
            try p.run(); child = p
        } catch { render(.offline, detail:"服务启动失败，请检查桌面安装") }
    }
    @objc func showMain() {
        hidePanel()
        NSApp.activate(ignoringOtherApps:true); main.makeKeyAndOrderFront(nil)
        if online && web.url == nil && !web.isLoading { web.load(URLRequest(url:base)) }
    }
    func placePanel() {
        guard let screen = orb.screen ?? NSScreen.main else { return }
        panel.setFrameOrigin(panelOrigin(beside:orb.frame,size:panel.frame.size,in:screen.visibleFrame))
    }
    func togglePanel() { if panel.isVisible { hidePanel() } else { showPanel() } }
    @objc func showPanel() {
        placePanel(); ring.expanded = true; panel.makeKeyAndOrderFront(nil); panel.makeFirstResponder(enter)
    }
    @objc func hidePanel() { panel.orderOut(nil); ring.expanded = false }
    @objc func revealMCP() {
        let launcher = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/mcp/mamba-mcp")
        NSWorkspace.shared.activateFileViewerSelecting([launcher])
    }
    let reader=NSWindow(contentRect:NSRect(x:0,y:0,width:710,height:680),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
    struct LibraryDocument {
        let root: URL
        let file: URL

        func read() throws -> String {
            let resolved = file.resolvingSymlinksInPath().standardizedFileURL
            let boundary = root.resolvingSymlinksInPath().standardizedFileURL
            guard resolved.path.hasPrefix(boundary.path + "/"), resolved.pathExtension.lowercased() == "md",
                  !resolved.pathComponents.contains(where: { $0.hasPrefix("90-隔离") }),
                  try resolved.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
                throw CocoaError(.fileReadNoPermission)
            }
            return try String(contentsOf: resolved, encoding: .utf8)
        }
    }

    var currentDocument: LibraryDocument?
    let readerText = NSTextView()
    var readAttempt = UUID()

    func showDocument(_ document: LibraryDocument) {
        currentDocument = document
        if reader.titlebarAccessoryViewControllers.isEmpty {
            let accessory = NSTitlebarAccessoryViewController()
            let choose = button("选择资料文件夹…", #selector(chooseDocumentFolder))
            choose.sizeToFit()
            accessory.view = choose
            accessory.layoutAttribute = .right
            reader.addTitlebarAccessoryViewController(accessory)
            let scroll = NSScrollView()
            scroll.hasVerticalScroller = true
            scroll.autohidesScrollers = true
            readerText.isEditable = false
            readerText.isRichText = false
            readerText.isVerticallyResizable = true
            readerText.autoresizingMask = [.width]
            readerText.textContainer?.widthTracksTextView = true
            readerText.textContainerInset = NSSize(width: 22, height: 18)
            readerText.font = .systemFont(ofSize: 15)
            readerText.frame = reader.contentView!.bounds
            scroll.documentView = readerText
            reader.contentView = scroll
        }
        reader.isReleasedWhenClosed = false
        reader.title = document.file.deletingPathExtension().lastPathComponent
        if !reader.isVisible { reader.center() }
        NSApp.activate(ignoringOtherApps: true)
        reader.makeKeyAndOrderFront(nil)
        readDocument(document)
    }

    func readDocument(_ document: LibraryDocument, selectedFolder: URL? = nil) {
        let attempt = UUID()
        readAttempt = attempt
        readerText.string = "正在读取原文。如果没有出现系统提示，可点击右上角的“选择资料文件夹…”。"
        DispatchQueue.global(qos: .userInitiated).async {
            let access = selectedFolder?.startAccessingSecurityScopedResource() ?? false
            defer { if access { selectedFolder?.stopAccessingSecurityScopedResource() } }
            let result = Result { try document.read() }
            DispatchQueue.main.async {
                guard self.readAttempt == attempt else { return }
                switch result {
                case .success(let text): self.readerText.string = text
                case .failure: self.readerText.string = "请点击“选择资料文件夹…”，选择存放该原文的文件夹后重试。"
                }
            }
        }
    }

    @objc func chooseDocumentFolder() {
        guard let document = currentDocument else { return }
        let folder = document.file.deletingLastPathComponent().standardizedFileURL
        let picker = NSOpenPanel()
        picker.canChooseDirectories = true
        picker.canChooseFiles = false
        picker.allowsMultipleSelection = false
        picker.directoryURL = folder
        picker.prompt = "选择资料文件夹"
        picker.message = "请选择存放当前原文的文件夹：" + folder.lastPathComponent
        picker.beginSheetModal(for: reader) { response in
            guard response == .OK, let chosen = picker.url, self.currentDocument?.file == document.file else { return }
            guard chosen.standardizedFileURL.path == folder.path else {
                self.readAttempt = UUID()
                self.readerText.string = "所选位置与原文索引不符。请重新选择：" + folder.path
                return
            }
            self.readDocument(document, selectedFolder: chosen)
        }
    }

    struct LibraryMap: Decodable { let root: String; let paths: [String: String] }
    func libraryFile(_ url: URL) -> LibraryDocument? {
        guard url.pathComponents.count == 3, url.pathComponents[1] == "local-document", url.query == nil, url.fragment == nil,
              let resource = Bundle.main.resourceURL,
              let runtime = try? runtimePaths(resource),
              let index = try? JSONDecoder().decode(LibraryMap.self, from: Data(contentsOf: URL(fileURLWithPath: runtime.data).appendingPathComponent("local-library/open.json"))),
              let relative = index.paths[url.lastPathComponent], !relative.hasPrefix("/"),
              !relative.split(separator: "/").contains(where: { $0 == ".." || $0.hasPrefix("90-隔离") }) else { return nil }
        let root = URL(fileURLWithPath: index.root)
        let file = root.appendingPathComponent(relative)
        guard file.pathExtension.lowercased() == "md" else { return nil }
        return LibraryDocument(root: root, file: file)
    }
    @objc func browser() { if online { NSWorkspace.shared.open(base) } }
    private func resizeMain(_ requested:NSSize) {
        guard !main.styleMask.contains(.fullScreen), let screen = main.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = NSSize(width:min(requested.width,visible.width),height:min(requested.height,visible.height))
        let frame = NSRect(origin:NSPoint(x: min(max(visible.minX,main.frame.minX),visible.maxX-size.width),
                                          y: max(visible.minY,min(visible.maxY,main.frame.maxY)-size.height)),size:size)
        main.setFrame(frame,display:true,animate:true)
    }
    @objc func compactWindow() {resizeMain(NSSize(width:650,height:760))}
    @objc func standardWindow() {resizeMain(NSSize(width:1180,height:840))}
    @objc func closeKey() { if panel.isKeyWindow { hidePanel() } else { NSApp.keyWindow?.performClose(nil) } }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldHandleReopen(_ sender:NSApplication, hasVisibleWindows flag:Bool) -> Bool { showMain(); return true }
    func applicationWillTerminate(_ notification:Notification) { timer?.invalidate(); if child?.isRunning == true { child?.terminate() } }
    func webView(_ webView:WKWebView, decidePolicyFor action:WKNavigationAction, decisionHandler:@escaping (WKNavigationActionPolicy)->Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.shouldPerformDownload && url.scheme == "blob" { decisionHandler(.download); return }
        let local = url.scheme == base.scheme && url.host == base.host && url.port == base.port
        if local && url.path.hasPrefix("/local-document/") {
            decisionHandler(.cancel)
            let origin=action.sourceFrame.securityOrigin
            guard action.sourceFrame.isMainFrame, action.navigationType == .linkActivated,
                  origin.protocol == base.scheme, origin.host == base.host, origin.port == base.port,
                  let file=libraryFile(url) else {
                showLinkResult("资料原文不可用，请检查本机资料目录");return
            }
            showDocument(file)
            return
        }
        if local { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated && ["https","http"].contains(url.scheme ?? "") {
            let ok=NSWorkspace.shared.open(url)
            showLinkResult(ok ? "已在系统浏览器打开" : "系统浏览器未能打开链接")
        }
        decisionHandler(.cancel)
    }
    func webView(_ webView:WKWebView,navigationAction:WKNavigationAction,didBecome download:WKDownload) { download.delegate = self }
    func download(_ download:WKDownload,decideDestinationUsing response:URLResponse,suggestedFilename:String,completionHandler:@escaping(URL?)->Void) {
        let dialog = NSSavePanel(); dialog.nameFieldStringValue = suggestedFilename
        dialog.beginSheetModal(for:main) { completionHandler($0 == .OK ? dialog.url : nil) }
    }
    func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void) {
        let picker = NSOpenPanel(); picker.beginSheetModal(for:main) { completionHandler($0 == .OK ? picker.urls : nil) }
    }
    func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage text:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void) {
        let alert = NSAlert(); alert.messageText = text; alert.addButton(withTitle:"继续"); alert.addButton(withTitle:"取消")
        alert.beginSheetModal(for:main) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func checkShortcut(_ key:String, code:UInt16) -> Bool {
        guard let window = NSApp.keyWindow, let event = NSEvent.keyEvent(with:.keyDown, location:.zero,
            modifierFlags:.command, timestamp:ProcessInfo.processInfo.systemUptime,
            windowNumber:window.windowNumber, context:nil, characters:key,
            charactersIgnoringModifiers:key, isARepeat:false, keyCode:code) else { return false }
        return NSApp.mainMenu?.performKeyEquivalent(with:event) == true
    }
    func runChecks() {
        var problems: [String] = []
        func check(_ condition: Bool, _ name: String) {
            if !condition { problems.append(name) }
        }
        func waitFor(_ condition: @escaping () -> Bool, then continuation: @escaping () -> Void, attempts: Int = 300) {
            if condition() || attempts == 0 { continuation(); return }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.1) { waitFor(condition,then:continuation,attempts:attempts-1) }
        }
        func snapshot(_ view: NSView, _ name: String) {
            guard let dir = ProcessInfo.processInfo.environment["MAMBA_UI_EVIDENCE"] else { return }
            view.layoutSubtreeIfNeeded(); view.displayIfNeeded()
            guard let bitmap = view.bitmapImageRepForCachingDisplay(in:view.bounds) else {
                problems.append("capture " + name); return
            }
            view.cacheDisplay(in:view.bounds,to:bitmap)
            do { try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:dir).appendingPathComponent(name+".png")) }
            catch { problems.append("save " + name) }
        }
        check(orb.isVisible && !main.isVisible && !panel.isVisible,"ring-only start")
        waitFor({ self.online }) {
            check(self.state == .ready && self.reading.stringValue == "已就绪","local health")
            for _ in 0..<3 {
                self.togglePanel()
                check(self.panel.isVisible && self.panel.isKeyWindow && self.panel.firstResponder === self.enter,"panel and primary focus")
                self.togglePanel()
                check(!self.panel.isVisible && !self.ring.expanded && self.orb.isVisible,"ring toggle")
            }
            self.showPanel()
            if let tab = NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:0,windowNumber:self.panel.windowNumber,context:nil,characters:"\t",charactersIgnoringModifiers:"\t",isARepeat:false,keyCode:48) { self.panel.sendEvent(tab) }
            check(self.panel.firstResponder === self.refresh,"Tab focus")
            if let esc = NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:0,windowNumber:self.panel.windowNumber,context:nil,characters:"\u{1b}",charactersIgnoringModifiers:"\u{1b}",isARepeat:false,keyCode:53) { self.panel.sendEvent(esc) }
            check(!self.panel.isVisible && !self.ring.expanded,"Escape")
            self.showPanel(); snapshot(self.ring,"ring"); snapshot(self.panel.contentView!,"status-ready")
            for frame in [NSRect(x:0,y:0,width:800,height:560), NSRect(x:-1440,y:23,width:1440,height:875)] {
                for x in [frame.minX,frame.maxX-self.orb.frame.width] {
                    for y in [frame.minY,frame.maxY-self.orb.frame.height] {
                        let orb = NSRect(origin:NSPoint(x:x,y:y),size:self.orb.frame.size)
                        let box = NSRect(origin:panelOrigin(beside:orb,size:self.panel.frame.size,in:frame),size:self.panel.frame.size)
                        check(frame.contains(box) && !orb.intersects(box),"panel edge placement")
                    }
                }
            }
            _ = self.ring.accessibilityPerformPress()

            waitFor({ self.web.title == "黑曼巴 · 工作室制片台" }) {
                check(self.main.isKeyWindow && !self.panel.isVisible,"enter workbench")
                check(self.web.title == "黑曼巴 · 工作室制片台","live isolated HUD")
                self.main.setContentSize(NSSize(width:620,height:460))
                check(self.web.frame.width >= 610 && self.web.frame.height > 350,"compact workbench")
                for _ in 0..<2 {
                    check(self.checkShortcut("w",code:13) && !self.main.isVisible && self.orb.isVisible,"close workbench")
                    self.showPanel()
                    check(self.checkShortcut("1",code:18) && self.main.isKeyWindow,"reopen workbench")
                }
                self.saveOrb(); let origin = self.orb.frame.origin; self.orb.setFrameOrigin(.zero); self.restoreOrb()
                check(self.orb.frame.origin == origin,"ring placement restore")
                self.showPanel()
                self.child?.terminate()
                waitFor({ self.state == .offline }) {
                    check(self.reading.stringValue == "未就绪" && self.ring.state == .offline,"stopped service feedback")
                    snapshot(self.panel.contentView!,"status-offline")
                    self.refresh.performClick(nil)
                    waitFor({ self.online }) {
                        check(self.state == .ready && self.refresh.isEnabled,"retry recovers service")
                        func finish() {
                            print(problems.isEmpty ? "PASS native UI: ring, workbench, keyboard focus, offline recovery and local reader" : "FAIL: "+problems.joined(separator:", "))
                            if !problems.isEmpty { self.applicationWillTerminate(Notification(name:NSApplication.willTerminateNotification)); exit(1) }
                            self.quit()
                        }
                        guard let fixture=self.libraryFile(base.appendingPathComponent("local-document/doc-test")) else {
                            problems.append("local fixture lookup");finish();return
                        }
                        self.showDocument(fixture)
                        func loaded() -> Bool { ((self.reader.contentView as? NSScrollView)?.documentView as? NSTextView)?.string == "本地原文验收" }
                        waitFor(loaded) { check(loaded(),"read local original");finish() }
                    }
                }
            }
        }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let desk = Desk()
app.delegate = desk
app.run()
