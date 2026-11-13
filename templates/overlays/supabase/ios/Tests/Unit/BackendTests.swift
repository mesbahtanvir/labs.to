import Testing

@testable import Idea

struct BackendTests {
  @Test func rejectsAMissingURL() {
    #expect(throws: Backend.ConfigurationError.missing("SUPABASE_URL")) {
      try Backend.makeClient(url: "", publishableKey: "key")
    }
  }

  @Test func rejectsAMissingKey() {
    #expect(throws: Backend.ConfigurationError.missing("SUPABASE_PUBLISHABLE_KEY")) {
      try Backend.makeClient(url: "http://127.0.0.1:44321", publishableKey: "")
    }
  }

  @Test func rejectsAMalformedURL() {
    #expect(throws: Backend.ConfigurationError.invalidURL("not a url")) {
      try Backend.makeClient(url: "not a url", publishableKey: "key")
    }
  }

  @Test func buildsAClientFromValidConfiguration() throws {
    _ = try Backend.makeClient(url: "http://127.0.0.1:44321", publishableKey: "key")
  }
}
