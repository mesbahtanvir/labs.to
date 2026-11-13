package to.labs.idea.backend

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import java.net.URI
import java.net.URISyntaxException

/**
 * Builds the Supabase client from the app's configuration.
 *
 * The URL and the publishable key come from BuildConfig (see build.gradle.kts and
 * local.properties). The publishable key is safe to ship in the app: row level
 * security, not the key, protects the data. Never put a secret or service role key in
 * the app.
 */
object Backend {
    class ConfigurationException(
        message: String,
    ) : IllegalStateException(message)

    fun createClient(
        url: String,
        publishableKey: String,
    ): SupabaseClient {
        if (url.isBlank()) throw ConfigurationException("supabase URL is not set")
        if (publishableKey.isBlank()) throw ConfigurationException("supabase publishable key is not set")
        val uri =
            try {
                URI(url)
            } catch (e: URISyntaxException) {
                throw ConfigurationException("supabase URL is not a valid URL: ${e.reason}")
            }
        if (uri.scheme == null || uri.host == null) throw ConfigurationException("supabase URL is not a valid URL")

        return createSupabaseClient(supabaseUrl = url, supabaseKey = publishableKey) {
            install(Auth)
            install(Postgrest)
        }
    }

    fun createClient(): SupabaseClient = createClient(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY)
}
