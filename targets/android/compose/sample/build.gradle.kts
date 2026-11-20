import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// The sample app: XtmdPage showing two pages built from Extended Mark source when the app is built, with the
// xtmd binary (targets/rust/target/release/xtmd): examples/pages/shop.xtmd, and pages/tour.xtmd,
// a tour of core's widgets. `./gradlew :sample:assembleDebug` writes the APK.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

val pages = layout.buildDirectory.dir("generated/xtmd/assets")

android {
    namespace = "xtmd.sample"
    compileSdk = 36
    buildToolsVersion = "36.1.0"
    ndkVersion = "30.0.16248370"
    defaultConfig {
        applicationId = "xtmd.android.sample"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.3.0"
        // the processors xtmd-android's native runtime is built for (../xtmd/build.sh android)
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    sourceSets { getByName("main") { assets.srcDir(pages) } }
    lint { abortOnError = false }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    implementation(project(":xtmd-android"))
    implementation(libs.activity.compose)

    // the app itself under Robolectric, with the host's native runtime
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.junit)
    testImplementation(libs.jna)
}

tasks.withType<Test>().configureEach {
    systemProperty("jna.library.path", rootProject.file("xtmd-android/native/host/linux-x86-64").absolutePath)
    maxHeapSize = "2g"
    // `-Pxtmd.render=<folder>`: RenderTest draws both pages there, as PNGs (README: Looking at it)
    (project.findProperty("xtmd.render") as String?)?.let { systemProperty("xtmd.render", file(it).absolutePath) }
}

// The pages' IR, from their Extended Mark source, by the compiler: `xtmd build <page> --out <name>.ir.json`.
val xtmd = rootProject.file("../../rust/target/release/xtmd")
val sources = mapOf(
    "shop" to rootProject.file("../../../examples/pages/shop.xtmd"),
    "tour" to file("pages/tour.xtmd"),
)
val buildPages = sources.map { (name, src) ->
    tasks.register<Exec>("xtmdPage${name.replaceFirstChar { it.uppercase() }}") {
        inputs.file(src)
        inputs.file(xtmd)
        val out = pages.map { it.file("$name.ir.json") }
        outputs.file(out)
        doFirst { out.get().asFile.parentFile.mkdirs() }
        commandLine(xtmd.absolutePath, "build", src.absolutePath, "--out", out.get().asFile.absolutePath)
    }
}
tasks.named("preBuild") { dependsOn(buildPages) }
