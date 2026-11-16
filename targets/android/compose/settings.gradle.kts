// MKP's Android target: `mkp-android` (the library: the Kotlin bindings to the native runtime, our
// default Compose widgets and MkpPage), and `sample`, an app showing a page. The check adapters
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
include(":mkp-android", ":sample")
