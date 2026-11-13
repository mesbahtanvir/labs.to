package to.labs.idea.backend

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Hand-written mirror of the public schema: the Supabase CLI can generate TypeScript
// and Swift types but not Kotlin. When a migration changes a table, update the model
// here, and the test in BackendTest.kt that decodes a real row.

/** A row of `public.notes`. */
@Serializable
data class Note(
    val id: String,
    @SerialName("user_id") val userId: String,
    val body: String,
    @SerialName("created_at") val createdAt: String,
)

/** What to send when inserting a note: the database fills in the rest. */
@Serializable
data class NewNote(
    val body: String,
)
