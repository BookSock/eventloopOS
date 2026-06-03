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
}
