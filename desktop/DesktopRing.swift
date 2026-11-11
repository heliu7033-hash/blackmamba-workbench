import AppKit

enum ServiceState {
    case checking, ready, offline
    var title: String {
        switch self {
        case .checking: return "正在检查"
        case .ready: return "已就绪"
        case .offline: return "未就绪"
        }
    }
    var color: NSColor {
        switch self {
        case .checking: return .lightGray
        case .ready: return accent
        case .offline: return NSColor(calibratedRed: 1, green: 0.73, blue: 0.42, alpha: 1)
        }
    }
}

func panelOrigin(beside orb: NSRect, size: NSSize, in frame: NSRect) -> NSPoint {
    let gap: CGFloat = 8
    let left = orb.minX - size.width - gap
    let right = orb.maxX + gap
    let x = left >= frame.minX || (right + size.width > frame.maxX && orb.midX >= frame.midX) ? left : right
    return fit(NSPoint(x: x, y: orb.midY - size.height / 2), size: size, in: frame)
}

final class StatusPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    // The status panel has three explicit actions even when system Tab navigation skips buttons.
    var actions: [NSButton] = []
    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown && event.keyCode == 48 && event.modifierFlags.intersection([.command,.control,.option]).isEmpty {
            let enabled = actions.filter { $0.isEnabled }
            if !enabled.isEmpty {
                let step = event.modifierFlags.contains(.shift) ? -1 : 1
                let index = enabled.firstIndex { $0 === firstResponder } ?? (step > 0 ? -1 : 0)
                makeFirstResponder(enabled[(index + step + enabled.count) % enabled.count])
            }
            return
        }
        super.sendEvent(event)
    }
    var dismissPanel: (() -> Void)?
    override func cancelOperation(_ sender: Any?) { dismissPanel?() }
}

final class Ring: NSView {
    private let brandMark = Bundle.main.url(forResource:"BrandMark",withExtension:"png").flatMap { NSImage(contentsOf:$0) }
    var activate: (() -> Void)?
    var moved: (() -> Void)?
    var state: ServiceState = .checking { didSet { needsDisplay = true } }
    var expanded = false { didSet { needsDisplay = true } }
    private var pressed = false { didSet { needsDisplay = true } }
    private var start = NSPoint.zero, origin = NSPoint.zero
    private var dragged = false

    override func draw(_ dirtyRect: NSRect) {
        let c = NSPoint(x: bounds.midX, y: bounds.midY)
        func circle(_ radius: CGFloat) -> NSBezierPath {
            NSBezierPath(ovalIn: NSRect(x: c.x-radius, y: c.y-radius, width: 2*radius, height: 2*radius))
        }
        ink.setFill(); circle(36).fill()
        accent.withAlphaComponent(pressed || expanded ? 1 : 0.78).setStroke()
        let rim=circle(35); rim.lineWidth=pressed ? 3 : 1.8; rim.stroke()
        brandMark?.draw(in:NSRect(x:c.x-18,y:c.y-16,width:36,height:39))
        let indicator = NSBezierPath()
        let length: CGFloat = state == .ready ? 9 : 4
        indicator.move(to:NSPoint(x:c.x-length/2,y:c.y-23)); indicator.line(to:NSPoint(x:c.x+length/2,y:c.y-23))
        state.color.setStroke(); indicator.lineWidth = 3; indicator.lineCapStyle = .round; indicator.stroke()
    }
    override func mouseDown(with event: NSEvent) {
        guard let win = window else { return }
        start = NSEvent.mouseLocation; origin = win.frame.origin; dragged = false; pressed = true
    }
    override func mouseDragged(with event: NSEvent) {
        let p = NSEvent.mouseLocation
        if hypot(p.x-start.x, p.y-start.y) > 4 { dragged = true }
        guard dragged, let win = window, let screen = NSScreen.screens.first(where: { $0.frame.contains(p) }) ?? win.screen else { return }
        win.setFrameOrigin(fit(NSPoint(x: origin.x+p.x-start.x,y: origin.y+p.y-start.y),size: win.frame.size,in: screen.visibleFrame))
        moved?()
    }
    override func mouseUp(with event: NSEvent) {
        pressed = false
        if !dragged { activate?() }
    }
    override func accessibilityPerformPress() -> Bool { activate?(); return true }
}
