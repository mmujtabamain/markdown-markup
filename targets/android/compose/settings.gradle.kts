// MKP's Android targets: `mkp-android` (the run-time library: the Kotlin bindings to the native
// runtime, our default Compose widgets, MkpPage and MkpDoc), `mkp-android-live` (the real-time one:
// MkpLiveDoc, with the compiler in its own native library), and `sample`, an app showing a page. The check adapters
// live in mkp-android's unit tests, which run Compose under Robolectric on the JVM.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "mkp-android-target"
include(":mkp-android", ":mkp-android-live", ":sample")
