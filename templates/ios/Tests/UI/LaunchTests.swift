import XCTest

final class LaunchTests: XCTestCase {
  @MainActor
  func testShowsGreeting() {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["greeting"].waitForExistence(timeout: 10))
  }
}
