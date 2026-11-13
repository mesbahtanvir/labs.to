package to.labs.idea.backend

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BackendInstrumentedTest {
    @Test
    fun buildsAClientOnADevice() {
        val url = "http://127.0.0.1:{{api_port}}"
        val client = Backend.createClient(url, "key")
        assertEquals(url, client.supabaseHttpUrl)
    }
}
