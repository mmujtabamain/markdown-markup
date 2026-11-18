import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// mkp-android-live: MKP's real-time Android target. MkpLiveDoc compiles a document's text on the
// device with the compiler in libmkp_android_live.so (mkp-live behind UniFFI, built by
// ../../mkp-live/build.sh into native/), then draws the IR with mkp-android's MkpDoc. An app that
// only draws pages it was given uses mkp-android alone, and ships no compiler.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    `maven-publish`
}

val native = layout.projectDirectory.dir("native")

android {
    namespace = "mkp.android.live"
    compileSdk = 36
    buildToolsVersion = "36.1.0"
    ndkVersion = "30.0.16248370"
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    sourceSets {
        getByName("main") {
            // uniffi-bindgen's mkp/android/live/ffi/mkp_android_live.kt, and libmkp_android_live.so per processor
            java.srcDir(native.dir("kotlin"))
            jniLibs.srcDir(native.dir("jniLibs"))
        }
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
    lint { abortOnError = false }
    publishing { singleVariant("release") { withSourcesJar() } }
}

afterEvaluate {
    publishing {
        publications {
            create<MavenPublication>("release") {
                from(components["release"])
                groupId = "mkp"
                artifactId = "mkp-android-live"
                version = "0.3.0"
            }
        }
        repositories { maven { url = uri(rootProject.layout.buildDirectory.dir("repo")) } }
    }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    api(project(":mkp-android"))
    implementation("${libs.jna.aar.get()}@aar")

    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.junit)
    testImplementation(libs.jna)
    debugImplementation(libs.compose.ui.test.manifest)
}

val nativeThere = tasks.register("checkNative") {
    val bindings = native.file("kotlin/mkp/android/live/ffi/mkp_android_live.kt").asFile
    doLast {
        if (!bindings.exists()) throw GradleException("no bindings in ${bindings.parent}: run targets/android/mkp-live/build.sh first")
    }
}
tasks.named("preBuild") { dependsOn(nativeThere) }

// The unit tests load both host libraries through JNA: the compiler's, and mkp-android's runtime.
tasks.withType<Test>().configureEach {
    val runtime = project(":mkp-android").layout.projectDirectory.dir("native/host/linux-x86-64").asFile
    systemProperty("jna.library.path", listOf(native.dir("host/linux-x86-64").asFile, runtime).joinToString(File.pathSeparator) { it.absolutePath })
    maxHeapSize = "2g"
}
