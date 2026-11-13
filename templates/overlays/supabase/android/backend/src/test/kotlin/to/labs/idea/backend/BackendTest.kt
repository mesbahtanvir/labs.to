package to.labs.idea.backend

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

// Building a client itself needs an Android context (see BackendInstrumentedTest), so
// these JVM tests cover the configuration checks and the models.
class BackendTest {
    private val localUrl = "http://127.0.0.1:{{api_port}}"

    @Test
    fun rejectsAMissingUrl() {
        val e = assertThrows(Backend.ConfigurationException::class.java) { Backend.createClient("", "key") }
        assertEquals("supabase URL is not set", e.message)
    }

    @Test
    fun rejectsAMissingKey() {
        val e = assertThrows(Backend.ConfigurationException::class.java) { Backend.createClient(localUrl, "") }
        assertEquals("supabase publishable key is not set", e.message)
    }

    @Test
    fun rejectsAMalformedUrl() {
        assertThrows(Backend.ConfigurationException::class.java) { Backend.createClient("not a url", "key") }
    }

    @Test
    fun decodesARowOfTheNotesTable() {
        // The shape PostgREST returns for public.notes (see supabase/migrations).
        val row =
            """
            {"id":"0b9a3c3e-3d5f-4c63-9d8e-2c6a1f5d7e10","user_id":"7f1e8a52-9a77-4b0e-8d57-6f1c2a9e4b33",
            "body":"hello","created_at":"2026-01-01T00:00:00+00:00"}
            """.trimIndent()
        val note = Json.decodeFromString<Note>(row)
        assertEquals("hello", note.body)
        assertEquals("7f1e8a52-9a77-4b0e-8d57-6f1c2a9e4b33", note.userId)
    }
}
