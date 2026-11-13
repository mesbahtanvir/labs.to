import Foundation
import Supabase

internal enum GraphqlPublicSchema {
}
internal enum PublicSchema {
  internal struct NotesSelect: Codable, Hashable, Sendable {
    internal let body: String
    internal let createdAt: String
    internal let id: UUID
    internal let userId: UUID
    internal enum CodingKeys: String, CodingKey {
      case body = "body"
      case createdAt = "created_at"
      case id = "id"
      case userId = "user_id"
    }
  }
  internal struct NotesInsert: Codable, Hashable, Sendable {
    internal let body: String
    internal let createdAt: String?
    internal let id: UUID?
    internal let userId: UUID?
    internal enum CodingKeys: String, CodingKey {
      case body = "body"
      case createdAt = "created_at"
      case id = "id"
      case userId = "user_id"
    }
  }
  internal struct NotesUpdate: Codable, Hashable, Sendable {
    internal let body: String?
    internal let createdAt: String?
    internal let id: UUID?
    internal let userId: UUID?
    internal enum CodingKeys: String, CodingKey {
      case body = "body"
      case createdAt = "created_at"
      case id = "id"
      case userId = "user_id"
    }
  }
}
