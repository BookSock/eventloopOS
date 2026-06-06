import Carbon
import XCTest
@testable import EventLoopQueueApp

final class GlobalHotKeyControllerTests: XCTestCase {
    func testRegistersSuperhumanStyleAliasesAlongsideLegacyHotkeys() {
        let keyPairs = Set(GlobalHotKeyController.registeredBindings.map { "\($0.keyCode):\($0.modifiers)" })
        let superhumanModifiers = UInt32(controlKey | optionKey)

        XCTAssertTrue(keyPairs.contains("\(UInt32(kVK_ANSI_J)):\(superhumanModifiers)"))
        XCTAssertTrue(keyPairs.contains("\(UInt32(kVK_ANSI_E)):\(superhumanModifiers)"))
        XCTAssertTrue(keyPairs.contains("\(UInt32(kVK_Return)):\(superhumanModifiers)"))
        XCTAssertTrue(keyPairs.contains("\(UInt32(kVK_ANSI_H)):\(superhumanModifiers)"))
        XCTAssertTrue(keyPairs.contains("\(UInt32(kVK_ANSI_R)):\(superhumanModifiers)"))
        XCTAssertTrue(keyPairs.contains("\(UInt32(kVK_ANSI_K)):\(superhumanModifiers)"))
        XCTAssertTrue(keyPairs.contains("\(UInt32(kVK_ANSI_M)):\(superhumanModifiers)"))
        XCTAssertTrue(keyPairs.contains("\(UInt32(kVK_ANSI_J)):\(UInt32(cmdKey | optionKey | shiftKey))"))
    }

    func testRegisteredHotkeysHaveUniqueKeyCombinationsAndIDs() {
        let keyPairs = Set(GlobalHotKeyController.registeredBindings.map { "\($0.keyCode):\($0.modifiers)" })
        let actionIDs = Set(GlobalHotKeyController.registeredBindings.map(\.actionID))

        XCTAssertEqual(keyPairs.count, GlobalHotKeyController.registeredBindings.count)
        XCTAssertEqual(actionIDs.count, GlobalHotKeyController.registeredBindings.count)
    }

    @MainActor
    func testDebouncesRepeatedIdenticalHotkeyWithoutBlockingOtherHotkeys() {
        let counts = HotKeyActionCounts()
        let controller = Self.makeController(counts: counts, repeatDebounceInterval: 0.30)
        let restoreActionID = Self.actionID(
            keyCode: UInt32(kVK_ANSI_R),
            modifiers: UInt32(controlKey | optionKey)
        )
        let masterActionID = Self.actionID(
            keyCode: UInt32(kVK_ANSI_K),
            modifiers: UInt32(controlKey | optionKey)
        )
        let startedAt = Date(timeIntervalSince1970: 100)

        XCTAssertTrue(controller.dispatchHotKeyAction(hotKeyID: restoreActionID, now: startedAt))
        XCTAssertFalse(controller.dispatchHotKeyAction(
            hotKeyID: restoreActionID,
            now: startedAt.addingTimeInterval(0.10)
        ))
        XCTAssertEqual(counts.restoreWorkspace, 1)

        XCTAssertTrue(controller.dispatchHotKeyAction(
            hotKeyID: masterActionID,
            now: startedAt.addingTimeInterval(0.10)
        ))
        XCTAssertEqual(counts.masterCommand, 1)

        XCTAssertTrue(controller.dispatchHotKeyAction(
            hotKeyID: restoreActionID,
            now: startedAt.addingTimeInterval(0.31)
        ))
        XCTAssertEqual(counts.restoreWorkspace, 2)
    }

    @MainActor
    func testDebouncesLegacyAndSuperhumanAliasesAsSameAction() {
        let counts = HotKeyActionCounts()
        let controller = Self.makeController(counts: counts, repeatDebounceInterval: 0.30)
        let superhumanAdvanceActionID = Self.actionID(
            keyCode: UInt32(kVK_ANSI_J),
            modifiers: UInt32(controlKey | optionKey)
        )
        let legacyAdvanceActionID = Self.actionID(
            keyCode: UInt32(kVK_ANSI_J),
            modifiers: UInt32(cmdKey | optionKey | shiftKey)
        )
        let startedAt = Date(timeIntervalSince1970: 200)

        XCTAssertTrue(controller.dispatchHotKeyAction(hotKeyID: superhumanAdvanceActionID, now: startedAt))
        XCTAssertFalse(controller.dispatchHotKeyAction(
            hotKeyID: legacyAdvanceActionID,
            now: startedAt.addingTimeInterval(0.10)
        ))
        XCTAssertEqual(counts.advance, 1)

        XCTAssertTrue(controller.dispatchHotKeyAction(
            hotKeyID: legacyAdvanceActionID,
            now: startedAt.addingTimeInterval(0.31)
        ))
        XCTAssertEqual(counts.advance, 2)
    }

    private static func actionID(keyCode: UInt32, modifiers: UInt32) -> UInt32 {
        guard let binding = GlobalHotKeyController.registeredBindings.first(where: {
            $0.keyCode == keyCode && $0.modifiers == modifiers
        }) else {
            XCTFail("missing hotkey binding for \(keyCode):\(modifiers)")
            return 0
        }
        return binding.actionID
    }

    @MainActor
    private static func makeController(
        counts: HotKeyActionCounts,
        repeatDebounceInterval: TimeInterval
    ) -> GlobalHotKeyController {
        GlobalHotKeyController(
            advance: { counts.advance += 1 },
            doneNext: { counts.doneNext += 1 },
            executeRecommendedAction: { counts.executeRecommendedAction += 1 },
            deferOneHour: { counts.deferOneHour += 1 },
            restoreWorkspace: { counts.restoreWorkspace += 1 },
            returnHere: { counts.returnHere += 1 },
            toggleManualMode: { counts.toggleManualMode += 1 },
            masterCommand: { counts.masterCommand += 1 },
            repeatDebounceInterval: repeatDebounceInterval
        )
    }
}

@MainActor
private final class HotKeyActionCounts {
    var advance = 0
    var doneNext = 0
    var executeRecommendedAction = 0
    var deferOneHour = 0
    var restoreWorkspace = 0
    var returnHere = 0
    var toggleManualMode = 0
    var masterCommand = 0
}
