// Extended Mark's Android targets: `xtmd-android` (the run-time library: the Kotlin bindings to the native
// runtime, our default Compose widgets, XtmdPage and XtmdDoc), `xtmd-android-live` (the real-time one:
// XtmdLiveDoc, with the compiler in its own native library), and `sample`, an app showing a page. The check adapters
// live in xtmd-android's unit tests, which run Compose under Robolectric on the JVM.
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
rootProject.name = "xtmd-android-target"
include(":xtmd-android", ":xtmd-android-live", ":sample")
