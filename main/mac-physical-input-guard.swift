import ApplicationServices
import CoreGraphics
import Foundation
import Darwin

private let stateLock = NSLock()
private var blocking = false
private var lastHumanReport: TimeInterval = 0
private var allowedPointerRegions: [CGRect] = []
private var buttonRegions: [(String, CGRect)] = []
private var pressedButton: String?
private var eventTap: CFMachPort?
private var boundsRefreshTimer: Timer?

private let blockedEventTypes: [CGEventType] = [
  .keyDown, .keyUp, .flagsChanged,
  .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
  .otherMouseDown, .otherMouseUp, .mouseMoved,
  .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
  .scrollWheel,
]

private func eventMask() -> CGEventMask {
  blockedEventTypes.reduce(0) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }
}

private func isPointerEvent(_ type: CGEventType) -> Bool {
  switch type {
  case .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
       .otherMouseDown, .otherMouseUp, .mouseMoved, .leftMouseDragged,
       .rightMouseDragged, .otherMouseDragged, .scrollWheel:
    return true
  default:
    return false
  }
}

private func refreshAllowedPointerRegions() {
  let maxDisplays: UInt32 = 16
  var displayIDs = [CGDirectDisplayID](repeating: 0, count: Int(maxDisplays))
  var displayCount: UInt32 = 0
  guard CGGetActiveDisplayList(maxDisplays, &displayIDs, &displayCount) == .success else { return }
  displayIDs = Array(displayIDs.prefix(Int(displayCount)))

  let displayBounds = displayIDs.map { CGDisplayBounds($0) }
  // The menu bar spans the whole display; allowing it lets users open apps or settings
  // while the desktop lock is active. Only already-visible small system dialogs/popovers
  // are allowed below.
  var regions: [CGRect] = []
  let windows = (CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]]) ?? []
  for window in windows {
    guard let owner = window[kCGWindowOwnerName as String] as? String,
          owner == "ControlCenter" || owner == "SystemUIServer" || owner == "loginwindow",
          let alpha = window[kCGWindowAlpha as String] as? Double, alpha > 0,
          let bounds = window[kCGWindowBounds as String] as? NSDictionary,
          let frame = CGRect(dictionaryRepresentation: bounds),
          frame.width > 0, frame.height > 0,
          frame.width < 1800, frame.height < 1000 else { continue }

    // Allow the small system confirmation dialogs used by shutdown and restart.
    if owner == "loginwindow" {
      guard frame.width < 1000, frame.height < 700 else { continue }
      for display in displayBounds {
        if let clipped = frame.intersection(display) as CGRect?, !clipped.isNull {
          regions.append(clipped)
        }
      }
      continue
    }

    // Only include popovers attached to the menu bar; ignore unrelated desktop windows.
    for display in displayBounds {
      let menuBar = CGRect(x: display.minX, y: display.minY, width: display.width, height: min(35, display.height))
      if frame.insetBy(dx: -24, dy: -24).intersects(menuBar),
         let clipped = frame.intersection(display) as CGRect?, !clipped.isNull {
        regions.append(clipped)
      }
    }
  }

  stateLock.lock()
  allowedPointerRegions = regions
  stateLock.unlock()
}

private func callback(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent, _ refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let tap = eventTap {
      CGEvent.tapEnable(tap: tap, enable: true)
    }
    return Unmanaged.passUnretained(event)
  }

  stateLock.lock()
  let shouldBlock = blocking
  let pointerRegions = allowedPointerRegions
  let buttons = buttonRegions
  stateLock.unlock()
  let sourcePID = event.getIntegerValueField(.eventSourceUnixProcessID)
  let sourceState = event.getIntegerValueField(.eventSourceStateID)
  let at = Date().timeIntervalSince1970
  if sourcePID == 0 && sourceState == Int64(CGEventSourceStateID.hidSystemState.rawValue),
     type != .mouseMoved && at - lastHumanReport >= 15 {
    lastHumanReport = at
    print("HUMAN \(Int64(at * 1000))")
    fflush(stdout)
  }
  guard shouldBlock else { return Unmanaged.passUnretained(event) }
  let source = event.getIntegerValueField(.eventSourceStateID)
  if source == Int64(CGEventSourceStateID.hidSystemState.rawValue) && type == .mouseMoved {
    return Unmanaged.passUnretained(event) // movement alone never grants a desktop click
  }
  if source == Int64(CGEventSourceStateID.hidSystemState.rawValue), isPointerEvent(type) {
    let hit = buttons.first(where: { $0.1.contains(event.location) })?.0
    stateLock.lock()
    if type == .leftMouseDown { pressedButton = hit }
    let activate = type == .leftMouseUp && hit != nil && hit == pressedButton
    if type == .leftMouseUp { pressedButton = nil }
    stateLock.unlock()
    if activate, let hit {
      print("BUTTON \(hit)")
      fflush(stdout)
    }
    // Route button clicks to the existing app handler, never the covered desktop.
    if hit != nil && type != .mouseMoved { return nil }
  }
  if source == Int64(CGEventSourceStateID.hidSystemState.rawValue), isPointerEvent(type),
     pointerRegions.contains(where: { $0.contains(event.location) }) {
    return Unmanaged.passUnretained(event)
  }
  return nil
}

guard AXIsProcessTrusted() else {
  if CommandLine.arguments.contains("--prompt-accessibility") {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
  }
  fputs("ERROR: ACCESSIBILITY_PERMISSION_REQUIRED\n", stderr)
  exit(2)
}

eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: eventMask(),
  callback: callback,
  userInfo: nil
)
guard let eventTap else {
  fputs("ERROR: EVENT_TAP_UNAVAILABLE\n", stderr)
  exit(3)
}
refreshAllowedPointerRegions()
boundsRefreshTimer = Timer(timeInterval: 0.25, repeats: true) { _ in
  stateLock.lock()
  let active = blocking
  stateLock.unlock()
  if active { refreshAllowedPointerRegions() }
}
if let boundsRefreshTimer {
  RunLoop.current.add(boundsRefreshTimer, forMode: .common)
}
let sourceRef = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), sourceRef, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
print("READY")
fflush(stdout)

DispatchQueue.global().async {
  while let line = readLine() {
    var reply: String?
    stateLock.lock()
    if line == "lock" { blocking = true; reply = "LOCKED" }
    else if line == "unlock" { blocking = false; reply = "UNLOCKED" }
    else if line.hasPrefix("state ") {
      let requestId = line.dropFirst(6)
      if requestId.range(of: "^[0-9]+$", options: .regularExpression) != nil {
        reply = "STATE \(requestId) \(blocking ? "LOCKED" : "UNLOCKED")"
      }
    }
    else if line.hasPrefix("buttons ") {
      buttonRegions = line.dropFirst(8).split(separator: ";").compactMap { row in
        let parts = row.split(separator: ",")
        guard parts.count == 5,
              String(parts[0]).range(of: "^[0-9]+_[a-zA-Z0-9_-]+$", options: .regularExpression) != nil,
              let x = Double(parts[1]), let y = Double(parts[2]),
              let width = Double(parts[3]), let height = Double(parts[4]),
              [x,y,width,height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return nil }
        return (String(parts[0]), CGRect(x:x,y:y,width:width,height:height))
      }
      if !buttonRegions.contains(where: { $0.0 == pressedButton }) { pressedButton = nil }
    }
    stateLock.unlock()
    if let reply {
      print(reply)
      fflush(stdout)
    }
  }
  CFRunLoopStop(CFRunLoopGetMain())
}
CFRunLoopRun()
