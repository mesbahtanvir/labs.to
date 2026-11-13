import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlinter)
}

// Backend libraries are pinned here, in one place. supabase-kt 3.9 needs Ktor 3.6 or newer.
val supabaseVersion = "3.9.0"
val ktorVersion = "3.6.1"
val serializationVersion = "1.13.0"

// Per-machine values (the publishable key, a LAN address) live in local.properties,
// which is not tracked. Copy local.properties.example to start.
val localProperties =
    providers.fileContents(rootProject.layout.projectDirectory.file("local.properties"))
        .asText
        .map { text -> Properties().apply { load(text.reader()) } }
        .orElse(Properties())

fun setting(key: String, default: String): String = localProperties.get().getProperty(key, default)

fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// Keep compileSdk, minSdk, Java and lint settings in step with app/build.gradle.kts.
android {
    namespace = "to.labs.idea.backend"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            // 10.0.2.2 is how the emulator reaches this computer, where the local stack runs.
            buildConfigField("String", "SUPABASE_URL", quoted(setting("supabase.url", "http://10.0.2.2:{{api_port}}")))
            buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", quoted(setting("supabase.publishableKey", "")))
        }
        release {
            // Fill these in local.properties when the idea has a hosted project (stage alpha).
            buildConfigField("String", "SUPABASE_URL", quoted(setting("supabase.release.url", "")))
            buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", quoted(setting("supabase.release.publishableKey", "")))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        warningsAsErrors = true
        abortOnError = true
        // UseTomlInstead: the backend's libraries are pinned at the top of this file, not in the
        // shared version catalog, so that an idea without a backend carries none of them.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "UseTomlInstead")
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
        allWarningsAsErrors = true
        // -Wextra: the compiler's extra checks (unused variables and the like) are off by default.
        extraWarnings = true
    }
}

dependencies {
    api(platform("io.github.jan-tennert.supabase:bom:$supabaseVersion"))
    api("io.github.jan-tennert.supabase:auth-kt")
    api("io.github.jan-tennert.supabase:postgrest-kt")
    implementation("io.ktor:ktor-client-okhttp:$ktorVersion")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:$serializationVersion")

    testImplementation(libs.junit)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
}
