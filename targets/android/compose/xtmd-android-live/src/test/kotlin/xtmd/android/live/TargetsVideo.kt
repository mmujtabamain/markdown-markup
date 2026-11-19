package xtmd.android.live

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runAndroidComposeUiTest
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.File
import xtmd.android.DocError
import xtmd.android.XtmdDoc
import xtmd.android.XtmdDocState
import xtmd.android.XtmdWork
import xtmd.android.Snapshot
import xtmd.android.ffi.Val
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Compose's two kinds of target in one screen, as frames for a video: xtmd-android's XtmdDoc drawing
 * the IR `xtmd build` wrote (run time) and XtmdLiveDoc compiling its text on the device (real time),
 * driven through a script, each step's frame rendered by Robolectric's native graphics and written
 * with how long it shows. Runs only when asked:
 *
 *   ./gradlew :xtmd-android-live:testDebugUnitTest --tests '*TargetsVideo*' -Pxtmd.video.out=/path/to/frames
 *
 * then `ffmpeg -f concat -i frames/list.txt …` makes the video (frames/list.txt says each frame's time).
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w1280dp-h800dp-land-notnight-mdpi")
class TargetsVideo {
    private val out = System.getProperty("xtmd.video.out")
    private val repo = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }.first { File(it, "targets/checks").isDirectory }

    private fun ComposeUiTest.done() {
        val end = System.nanoTime() + 30_000_000_000L
        do {
            waitForIdle()
            Thread.sleep(5)
        } while (!XtmdWork.idle && System.nanoTime() < end)
        waitForIdle()
    }

    private fun line(s: Map<String, Val>) = s.entries.joinToString(", ") { (k, v) -> "$k = ${(v as? Val.Num)?.n ?: v}" }

    @Test
    fun record() = runAndroidComposeUiTest<ComponentActivity> {
        assumeTrue("set -Pxtmd.video.out to write the frames", out != null)
        val dir = File(out!!).apply { mkdirs() }
        val text0 = File(repo, "apps/playground/examples/counter.xt.md").readText()
        val ir = File(dir, "counter.ir.json").readText()
        val run = XtmdDocState()
        val live = XtmdDocState()
        var source by mutableStateOf(text0)
        var shown by mutableStateOf(text0)
        var caption by mutableStateOf("")
        var status by mutableStateOf("Compiled on the device")
        var broken by mutableStateOf(false)
        var runState by mutableStateOf("")
        var saved by mutableStateOf<Snapshot?>(null)
        setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize().background(Color(0xFFF6F7F9))) {
                    Column(Modifier.fillMaxSize().padding(16.dp)) {
                        Text("One page, Compose's two kinds of target", fontSize = 20.sp, color = Color(0xFF1A1C1F))
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                            Column(Modifier.weight(1f).padding(end = 8.dp)) {
                                Text("Run time: XtmdDoc (xtmd-android)", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text("XtmdDoc(ir = …): the IR xtmd build wrote. No compiler on the device.", fontSize = 12.sp, color = Color(0xFF6B7280))
                                Box(Modifier.padding(top = 6.dp).border(1.dp, Color(0xFFD4D7DC)).background(Color.White).padding(8.dp)) {
                                    XtmdDoc(ir = ir, docState = run, onStateChange = { runState = line(it) })
                                }
                                Text("\$state: $runState", fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                                saved?.let { Text("snapshot taken", fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Color(0xFF6B7280)) }
                            }
                            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                                Text("Real time: XtmdLiveDoc (xtmd-android-live)", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text("XtmdLiveDoc(source = text): compiled on the device as it changes.", fontSize = 12.sp, color = Color(0xFF6B7280))
                                Text(
                                    shown.lines().takeLast(6).joinToString("\n"),
                                    Modifier.padding(top = 6.dp).fillMaxWidth().background(Color.White).border(1.dp, Color(0xFFD4D7DC)).padding(6.dp),
                                    fontFamily = FontFamily.Monospace, fontSize = 11.sp,
                                )
                                Text(status, fontSize = 12.sp, color = if (broken) Color(0xFFC62828) else Color(0xFF15803D))
                                Box(Modifier.border(1.dp, Color(0xFFD4D7DC)).background(Color.White).padding(8.dp)) {
                                    XtmdLiveDoc(source = source, docState = live, onError = { e ->
                                        if (e is DocError.Compile) {
                                            broken = true
                                            status = e.message.replace("page.xt.md doesn't compile", "Doesn't compile")
                                        }
                                    })
                                }
                            }
                        }
                    }
                    if (caption.isNotEmpty()) {
                        Text(
                            caption,
                            Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp).background(Color(0xE6141619)).padding(horizontal = 14.dp, vertical = 8.dp),
                            color = Color.White, fontSize = 20.sp,
                        )
                    }
                }
            }
        }
        done()
        runState = line(run.state())

        var n = 0
        val list = StringBuilder()
        /** The screen now, shown for `seconds`. */
        fun frame(seconds: Double) {
            done()
            // the activity's views drawn into a bitmap, as the screen would show them
            val view = activity!!.window.decorView
            val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            runOnUiThread { view.draw(android.graphics.Canvas(bmp)) }
            val f = File(dir, "f%04d.png".format(n++))
            f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            list.append("file '${f.absolutePath}'\nduration $seconds\n")
        }
        fun say(s: String, seconds: Double) {
            caption = s
            frame(seconds)
        }
        /** Typing, a few keys a frame, then the text compiled. */
        fun type(add: String) {
            for (chunk in add.chunked(3)) {
                shown += chunk
                frame(0.18)
            }
            source = shown
            status = "Compiled on the device"
            broken = false
        }

        say("Compose's two kinds of target, on one screen.", 3.0)
        say("Run time: XtmdDoc draws an IR built ahead (xtmd build). No compiler.", 3.2)
        caption = "A press: the page writes \$state, checked by xtmd."
        onAllNodesWithText("Add 1")[0].performClick()
        frame(1.4)
        onAllNodesWithText("Add 1")[0].performClick()
        frame(2.0)
        caption = "A snapshot of everything the page holds..."
        saved = run.snapshot()
        frame(1.4)
        onAllNodesWithText("Add 1")[0].performClick()
        frame(1.8)
        caption = "...and restore puts it back."
        run.restore(saved!!)
        frame(2.6)
        say("Real time: XtmdLiveDoc compiles this text on the device, with libxtmd_android_live.so.", 3.4)
        caption = "An edit: a counter that steps by 10."
        type("\n@counter(by = 10);\n")
        frame(3.0)
        caption = "A mistake: the step left out."
        type("@counter(by = );")
        frame(1.0)
        say("It doesn't compile: the error says where, and the last page stays.", 3.6)
        caption = "Taking the mistake out draws it again."
        shown = shown.removeSuffix("@counter(by = );")
        source = shown
        status = "Compiled on the device"
        broken = false
        frame(2.8)
        say("Compose: XtmdDoc and XtmdLiveDoc, each held to the 62 conformance cases.", 3.6)
        File(dir, "list.txt").writeText(list.toString() + "file '${File(dir, "f%04d.png".format(n - 1)).absolutePath}'\n")
    }

    /** A widget in a sentence: drawn among its words, and clicked like any other. Frames go in
     * `<xtmd.video.out>/inline`. */
    @Test
    fun aPressInASentence() = runAndroidComposeUiTest<ComponentActivity> {
        assumeTrue("set -Pxtmd.video.out to write the frames", out != null)
        val dir = File(out!!, "inline").apply { mkdirs() }
        val source = """
            ${'$'}state {
                count: int = 0;
            }
            @@@
            # A press in a sentence

            Press \{@press(label = "Add one", click = fn() { ${'$'}state.count = ${'$'}state.count + 1; })} and the count, **\{${'$'}state.count}**, goes up. The sentence wraps around the press, which is a widget of the page like any other: its click runs its handler.
        """.trimIndent() + "\n"
        val live = XtmdDocState()
        var caption by mutableStateOf("")
        setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize().background(Color(0xFFF6F7F9))) {
                    Column(Modifier.fillMaxSize().padding(16.dp)) {
                        Text("A widget in a sentence, in Compose", fontSize = 20.sp, color = Color(0xFF1A1C1F))
                        Text("XtmdLiveDoc compiles the page on the device; the press is the paragraph's slot, drawn as inline content.", fontSize = 12.sp, color = Color(0xFF6B7280))
                        Box(Modifier.padding(top = 8.dp).fillMaxWidth(0.5f).border(1.dp, Color(0xFFD4D7DC)).background(Color.White).padding(8.dp)) {
                            XtmdLiveDoc(source = source, docState = live)
                        }
                        Text(source, Modifier.padding(top = 12.dp), fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = Color(0xFF6B7280))
                    }
                    if (caption.isNotEmpty()) {
                        Text(
                            caption,
                            Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp).background(Color(0xE6141619)).padding(horizontal = 14.dp, vertical = 8.dp),
                            color = Color.White, fontSize = 20.sp,
                        )
                    }
                }
            }
        }
        done()
        var n = 0
        val list = StringBuilder()
        fun frame(seconds: Double) {
            done()
            val view = activity!!.window.decorView
            val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            runOnUiThread { view.draw(android.graphics.Canvas(bmp)) }
            val f = File(dir, "f%04d.png".format(n++))
            f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            list.append("file '${f.absolutePath}'\nduration $seconds\n")
        }
        caption = "A press inside a sentence, drawn among its words."
        frame(3.2)
        caption = "The line it sits in grows to it; the words wrap around it."
        frame(3.2)
        caption = "A click runs its handler: the count in the same sentence goes up."
        onNodeWithText("Add one").performClick()
        frame(1.6)
        onNodeWithText("Add one").performClick()
        frame(1.6)
        onNodeWithText("Add one").performClick()
        frame(2.4)
        caption = "egui and the web do the same, held to one conformance case."
        frame(3.4)
        File(dir, "list.txt").writeText(list.toString() + "file '${File(dir, "f%04d.png".format(n - 1)).absolutePath}'\n")
    }
}
