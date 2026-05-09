import Carbon
import Foundation

final class GlobalHotKeyController: @unchecked Sendable {
    private static let signature = OSType(0x45564C51) // EVLQ
    private static let pullNextPaperHotKeyID = UInt32(1)
    private static let toggleManualModeHotKeyID = UInt32(2)
    private static let masterCommandHotKeyID = UInt32(3)

    private var hotKeyRefs: [EventHotKeyRef] = []
    private var eventHandlerRef: EventHandlerRef?
    private let pullNextPaper: @MainActor @Sendable () -> Void
    private let toggleManualMode: @MainActor @Sendable () -> Void
    private let masterCommand: @MainActor @Sendable () -> Void

    init(
        pullNextPaper: @escaping @MainActor @Sendable () -> Void,
        toggleManualMode: @escaping @MainActor @Sendable () -> Void,
        masterCommand: @escaping @MainActor @Sendable () -> Void
    ) {
        self.pullNextPaper = pullNextPaper
        self.toggleManualMode = toggleManualMode
        self.masterCommand = masterCommand
    }

    deinit {
        unregister()
    }

    func registerHotKeys() {
        unregister()

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let userData = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData in
                guard let event, let userData else {
                    return noErr
                }

                var hotKeyID = EventHotKeyID()
                let status = GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &hotKeyID
                )
                guard status == noErr else {
                    return status
                }
                let controller = Unmanaged<GlobalHotKeyController>
                    .fromOpaque(userData)
                    .takeUnretainedValue()
                guard hotKeyID.signature == GlobalHotKeyController.signature,
                      let action = controller.action(for: hotKeyID.id) else {
                    return noErr
                }

                Task { @MainActor in
                    action()
                }
                return noErr
            },
            1,
            &eventType,
            userData,
            &eventHandlerRef
        )
        guard handlerStatus == noErr else {
            return
        }

        registerHotKey(
            keyCode: UInt32(kVK_ANSI_J),
            modifiers: UInt32(cmdKey | optionKey | shiftKey),
            id: Self.pullNextPaperHotKeyID
        )
        registerHotKey(
            keyCode: UInt32(kVK_ANSI_M),
            modifiers: UInt32(cmdKey | optionKey | shiftKey),
            id: Self.toggleManualModeHotKeyID
        )
        registerHotKey(
            keyCode: UInt32(kVK_ANSI_K),
            modifiers: UInt32(cmdKey | optionKey | shiftKey),
            id: Self.masterCommandHotKeyID
        )
    }

    private func action(for hotKeyID: UInt32) -> (@MainActor @Sendable () -> Void)? {
        switch hotKeyID {
        case Self.pullNextPaperHotKeyID:
            return pullNextPaper
        case Self.toggleManualModeHotKeyID:
            return toggleManualMode
        case Self.masterCommandHotKeyID:
            return masterCommand
        default:
            return nil
        }
    }

    private func registerHotKey(keyCode: UInt32, modifiers: UInt32, id: UInt32) {
        var hotKeyRef: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: Self.signature, id: id)
        let registerStatus = RegisterEventHotKey(
            keyCode,
            modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        if registerStatus != noErr {
            unregister()
            return
        }
        if let hotKeyRef {
            hotKeyRefs.append(hotKeyRef)
        }
    }

    private func unregister() {
        for hotKeyRef in hotKeyRefs {
            UnregisterEventHotKey(hotKeyRef)
        }
        hotKeyRefs.removeAll()
        if let eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
            self.eventHandlerRef = nil
        }
    }
}
