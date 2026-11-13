// Plugins are declared once here and applied in the modules. :backend (when the idea
// has a backend) uses android.library and kotlin.serialization.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlinter) apply false
}
