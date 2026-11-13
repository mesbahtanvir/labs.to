package to.labs.idea

import org.junit.Assert.assertEquals
import org.junit.Test

class GreetingTest {
    @Test
    fun namesTheApp() {
        assertEquals("Welcome to Labs", Greeting.make("Labs"))
    }
}
