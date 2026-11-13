import Foundation
import Supabase

/// Builds the Supabase client from the app's configuration.
///
/// The URL and the publishable key come from `Config/*.xcconfig` through
/// `Info.plist`. The publishable key is safe to ship in the app: row level
/// security, not the key, protects the data. Never put a secret or service role
/// key in the app.
enum Backend {
  enum ConfigurationError: Error, Equatable {
    case missing(String)
    case invalidURL(String)
  }

  static func makeClient(url: String, publishableKey: String) throws -> SupabaseClient {
    guard !url.isEmpty else { throw ConfigurationError.missing("SUPABASE_URL") }
    guard !publishableKey.isEmpty else {
      throw ConfigurationError.missing("SUPABASE_PUBLISHABLE_KEY")
    }
    guard let endpoint = URL(string: url), endpoint.scheme != nil, endpoint.host != nil else {
      throw ConfigurationError.invalidURL(url)
    }
    return SupabaseClient(supabaseURL: endpoint, supabaseKey: publishableKey)
  }

  static func makeClient(bundle: Bundle = .main) throws -> SupabaseClient {
    try makeClient(
      url: bundle.object(forInfoDictionaryKey: "SupabaseURL") as? String ?? "",
      publishableKey: bundle.object(forInfoDictionaryKey: "SupabasePublishableKey") as? String ?? ""
    )
  }
}
