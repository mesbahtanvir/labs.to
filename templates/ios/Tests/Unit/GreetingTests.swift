import Testing

@testable import Idea

struct GreetingTests {
  @Test func namesTheApp() {
    #expect(Greeting.make(for: "Labs") == "Welcome to Labs")
  }
}
