import Carbon
import Foundation

struct GlobalHotKeyBinding: Equatable {
    let keyCode: UInt32
    let modifiers: UInt32
    let actionID: UInt32
}

final class GlobalHotKeyController: @unchecked Sendable {
    private static let signature = OSType(0x45564C51) // EVLQ
    private static let legacyAdvanceHotKeyID = UInt32(1)
    private static let legacyToggleManualModeHotKeyID = UInt32(2)
    private static let legacyMasterCommandHotKeyID = UInt32(3)
    private static let advanceHotKeyID = UInt32(10)
    private static let doneNextHotKeyID = UInt32(11)
    private static let executeRecommendedActionHotKeyID = UInt32(12)
    private static let deferOneHourHotKeyID = UInt32(13)
    private static let restoreWorkspaceHotKeyID = UInt32(14)
    private static let returnHereHotKeyID = UInt32(15)
    private static let toggleManualModeHotKeyID = UInt32(16)
    private static let masterCommandHotKeyID = UInt32(17)

    static let registeredBindings: [GlobalHotKeyBinding] = {
        let legacyModifiers = UInt32(cmdKey | optionKey | shiftKey)
        let superhumanModifiers = UInt32(controlKey | optionKey)
        let superhumanShiftModifiers = UInt32(controlKey | optionKey | shiftKey)
        return [
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_J),
                modifiers: legacyModifiers,
                actionID: legacyAdvanceHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_M),
                modifiers: legacyModifiers,
                actionID: legacyToggleManualModeHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_K),
                modifiers: legacyModifiers,
                actionID: legacyMasterCommandHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_J),
                modifiers: superhumanModifiers,
                actionID: advanceHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_E),
                modifiers: superhumanModifiers,
                actionID: doneNextHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_Return),
                modifiers: superhumanModifiers,
                actionID: executeRecommendedActionHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_H),
                modifiers: superhumanModifiers,
                actionID: deferOneHourHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_R),
                modifiers: superhumanModifiers,
                actionID: restoreWorkspaceHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_M),
                modifiers: superhumanShiftModifiers,
                actionID: returnHereHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_M),
                modifiers: superhumanModifiers,
                actionID: toggleManualModeHotKeyID
            ),
            GlobalHotKeyBinding(
                keyCode: UInt32(kVK_ANSI_K),
                modifiers: superhumanModifiers,
                actionID: masterCommandHotKeyID
            ),
        ]
    }()

    private var hotKeyRefs: [EventHotKeyRef] = []
    private var eventHandlerRef: EventHandlerRef?
    private let advance: @MainActor @Sendable () -> Void
    private let doneNext: @MainActor @Sendable () -> Void
    private let executeRecommendedAction: @MainActor @Sendable () -> Void
    private let deferOneHour: @MainActor @Sendable () -> Void
    private let restoreWorkspace: @MainActor @Sendable () -> Void
    private let returnHere: @MainActor @Sendable () -> Void
    private let toggleManualMode: @MainActor @Sendable () -> Void
    private let masterCommand: @MainActor @Sendable () -> Void

    init(
        advance: @escaping @MainActor @Sendable () -> Void,
        doneNext: @escaping @MainActor @Sendable () -> Void,
        executeRecommendedAction: @escaping @MainActor @Sendable () -> Void,
        deferOneHour: @escaping @MainActor @Sendable () -> Void,
        restoreWorkspace: @escaping @MainActor @Sendable () -> Void,
        returnHere: @escaping @MainActor @Sendable () -> Void,
        toggleManualMode: @escaping @MainActor @Sendable () -> Void,
        masterCommand: @escaping @MainActor @Sendable () -> Void
    ) {
        self.advance = advance
        self.doneNext = doneNext
        self.executeRecommendedAction = executeRecommendedAction
        self.deferOneHour = deferOneHour
        self.restoreWorkspace = restoreWorkspace
        self.returnHere = returnHere
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

        for binding in Self.registeredBindings {
            registerHotKey(binding)
        }
    }

    private func action(for hotKeyID: UInt32) -> (@MainActor @Sendable () -> Void)? {
        switch hotKeyID {
        case Self.legacyAdvanceHotKeyID, Self.advanceHotKeyID:
            return advance
        case Self.doneNextHotKeyID:
            return doneNext
        case Self.executeRecommendedActionHotKeyID:
            return executeRecommendedAction
        case Self.deferOneHourHotKeyID:
            return deferOneHour
        case Self.restoreWorkspaceHotKeyID:
            return restoreWorkspace
        case Self.returnHereHotKeyID:
            return returnHere
        case Self.legacyToggleManualModeHotKeyID, Self.toggleManualModeHotKeyID:
            return toggleManualMode
        case Self.legacyMasterCommandHotKeyID, Self.masterCommandHotKeyID:
            return masterCommand
        default:
            return nil
        }
    }

    private func registerHotKey(_ binding: GlobalHotKeyBinding) {
        var hotKeyRef: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: Self.signature, id: binding.actionID)
        let registerStatus = RegisterEventHotKey(
            binding.keyCode,
            binding.modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        guard registerStatus == noErr else {
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
