import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlinter)
}

// The module, package and class names are the same in every idea, so tooling never needs
// an idea's name. The applicationId (the real app identity) comes from idea.yaml.
// compileSdk is what the libraries need (Compose 1.12 needs 37). targetSdk follows it, since
// Android Lint flags anything older. They are separate settings: raise targetSdk only after
// testing against the new platform's behavior changes.
android {
    namespace = "to.labs.idea"
    compileSdk = 37

    defaultConfig {
        applicationId = "{{bundle_id}}"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        warningsAsErrors = true
        abortOnError = true
        // Library freshness is decided deliberately (see gradle/libs.versions.toml),
        // not by a lint warning that needs the network.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")
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
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    // The backend overlay adds a :backend module; without one there is nothing to depend on.
    if (rootProject.findProject(":backend") != null) implementation(project(":backend"))

    testImplementation(libs.junit)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
}
