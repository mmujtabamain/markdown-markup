package mkp.android

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.AndroidComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.test.runAndroidComposeUiTest
import androidx.compose.ui.unit.dp
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import mkp.android.check.settle
import mkp.android.check.waitsForMkp
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * What a drag costs on the sample's tour page, step by step: the canvas's handle, the plane's pan
 * and the slider, a finger moving in small steps (motion events straight to the window, as a
 * phone's input gives them), Compose settling after each one. The window is the phone's screen,
 * 360 by 806 dp at density 2, scrolled to what is dragged. Each step's main-thread processor time
 * is measured (what holds a frame up; waiting is not counted), with the tree's trip from Rust to
 * Kotlin within it, and the runtime's time, which a drag spends off the main thread. A control
 * step, the same finger on a paragraph, is the input's and the test's own cost.
 *
 * The budget, [BUDGET_MS] a step of main-thread work beyond the control, is what this shared box
 * measures with the fixes (2 to 11 ms, at load averages of 20 to 40), with room for its load:
 * before them a step took 25 to 48 ms of main thread here (the runtime's write and the plane's layout on it, every widget composed again). A
 * budget phone is 5 to 10 times slower, so the drag itself (the handle, the thumb, the plane under
 * the finger) moves on frames of its own between writes, and the deterministic checks below hold
 * what the fixes do whatever the box's load: only changed widgets compose again and cross from
 * Rust, and a step is one write. The numbers are written to build/drag-perf.txt.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w360dp-h806dp-port-notnight-xhdpi")
class DragPerfTest {
    private val repo = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }.first { File(it, "targets/checks").isDirectory }
    private val mkp = File(repo, "targets/rust/target/release/mkp")

    private fun ir(source: File): String {
        assumeTrue("the mkp binary isn't built", mkp.canExecute())
        val out = File.createTempFile("mkp-page", ".ir.json")
        val p = ProcessBuilder(mkp.path, "build", source.path, "--out", out.path).redirectErrorStream(true).start()
        p.inputStream.bufferedReader().readText()
        check(p.waitFor() == 0)
        return out.readText().also { out.delete() }
    }

    private val tour by lazy { ir(File(repo, "targets/android/compose/sample/pages/tour.mkp.md")) }

    /** One kind of drag's steps, on average. */
    /** One kind of drag's steps, by their medians: the main thread's processor time (what holds a
     * frame up), the tree's trip to Kotlin within it, and the runtime's time off the main thread. */
    data class Steps(val kind: String, val steps: Int, val writes: Int, val totalMs: Double, val runtimeMs: Double, val callsMs: Double, val convertMs: Double, val treeMs: Double, val restMs: Double, val drawn: Double = 0.0, val sent: Double = 0.0) {
        override fun toString() =
            "%-8s %3d steps %3d changes | main thread %6.2f ms a step (tree to Kotlin %5.2f, of it Rust %5.2f) | runtime, off the main thread, %5.2f ms | %4.1f widgets composed, %4.1f nodes sent a step".format(kind, steps, writes, totalMs, treeMs, convertMs, runtimeMs, drawn, sent)
    }

    private fun node(ui: AndroidComposeUiTest<*>, tag: String): SemanticsNodeInteraction =
        if (tag.startsWith("text:")) ui.onNode(androidx.compose.ui.test.hasText(tag.removePrefix("text:")), useUnmergedTree = true)
        else ui.onNode(SemanticsMatcher.expectValue(SemanticsProperties.TestTag, tag), useUnmergedTree = true)

    private fun AndroidComposeUiTest<ComponentActivity>.measure(page: CompiledPage, kind: String, tag: String, from: (Offset, Offset) -> Offset, by: Offset): Steps {
        val target = node(this, tag)
        // on the phone's screen, as the reader scrolled to it
        target.performScrollTo()
        settle()
        // the finger as the screen gives it: motion events straight to the window, as a phone's
        // input does (the test API's own input looks the node up in the semantics tree on every
        // call, which costs more than the drag itself)
        val b = target.fetchSemanticsNode().boundsInWindow
        var at = from(b.center, Offset(b.left, b.center.y))
        val view = activity!!.window.decorView
        var time = android.os.SystemClock.uptimeMillis()
        val downTime = time
        fun send(action: Int) {
            time += 16
            val e = android.view.MotionEvent.obtain(downTime, time, action, at.x, at.y, 0)
            runOnUiThread { view.dispatchTouchEvent(e) }
            e.recycle()
        }
        fun moveBy(d: Offset) {
            at += d
            send(android.view.MotionEvent.ACTION_MOVE)
        }
        send(android.view.MotionEvent.ACTION_DOWN)
        settle()
        // past the touch slop, then warm up the JIT
        moveBy(by * 6f)
        settle()
        repeat(10) {
            moveBy(if (it % 2 == 0) by else -by)
            settle()
        }
        val n = 40
        // each step on its own, and the median of each part: this box is shared, and a mean takes
        // in whatever else ran at the time
        val cpuSteps = DoubleArray(n)
        val changeSteps = DoubleArray(n)
        val runtimeSteps = DoubleArray(n)
        val treeSteps = DoubleArray(n)
        val convertSteps = DoubleArray(n)
        val changes0 = page.stats.changes
        val draws0 = page.stats.draws
        val kept0 = page.stats.kept
        val sent0 = page.stats.sent
        val layout0 = page.stats.layoutNanos
        repeat(n) { k ->
            val t0 = page.native.timings()
            val c0 = page.stats.changeNanos
            val tr0 = page.stats.treeNanos
            // the thread's own time, not the wall clock's: waiting for the test's frame clock isn't work
            val started = cpu()
            moveBy(if (k % 2 == 0) by else -by)
            settle()
            cpuSteps[k] = (cpu() - started) / 1e6
            val t1 = page.native.timings()
            changeSteps[k] = (page.stats.changeNanos - c0) / 1e6
            treeSteps[k] = (page.stats.treeNanos - tr0) / 1e6
            runtimeSteps[k] = (t1.runtimeNanos - t0.runtimeNanos).toLong() / 1e6
            convertSteps[k] = (t1.convertNanos - t0.convertNanos).toLong() / 1e6
        }
        send(android.view.MotionEvent.ACTION_UP)
        settle()
        System.err.println("$kind: ${(page.stats.draws - draws0) / n} widgets drawn again a step; the layout took ${"%.2f".format((page.stats.layoutNanos - layout0) / 1e6 / n)} ms a step; tree updates kept ${(page.stats.kept - kept0) / n} nodes and sent ${(page.stats.sent - sent0) / n} a step")
        fun median(xs: DoubleArray) = xs.sorted()[xs.size / 2]
        val rest = DoubleArray(n) { cpuSteps[it] - changeSteps[it] - treeSteps[it] }
        return Steps(kind, n, page.stats.changes - changes0, median(cpuSteps), median(runtimeSteps), median(changeSteps), median(convertSteps), median(treeSteps), median(rest),
            (page.stats.draws - draws0).toDouble() / n, (page.stats.sent - sent0).toDouble() / n)
    }

    /** An idle step: Compose settling with nothing changed, the test's own cost. */
    private fun AndroidComposeUiTest<ComponentActivity>.idle(): Double {
        val started = cpu()
        repeat(40) { settle() }
        return (cpu() - started) / 1e6 / 40
    }

    /** The test thread's processor time: where Compose, the bindings and the runtime all run. */
    private fun cpu(): Long = cpuTime.invoke(threads) as Long

    private val cpuTime = Class.forName("java.lang.management.ThreadMXBean").getMethod("getCurrentThreadCpuTime")

    // java.lang.management isn't in android.jar, which the tests compile against; it is on the JVM
    private val threads: Any = Class.forName("java.lang.management.ManagementFactory").getMethod("getThreadMXBean").invoke(null)!!

    @Test
    fun dragsStayWithinTheirBudget() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val loadStart = System.nanoTime()
        val page = CompiledPage.fromJson(tour, PageOptions(zone = UtcZone))
        val load = (System.nanoTime() - loadStart) / 1e6
        val firstStart = System.nanoTime()
        setContent { Box(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) { MkpPage(page) } }
        settle()
        val first = (System.nanoTime() - firstStart) / 1e6
        val idle = idle()
        val only = System.getProperty("mkp.perf.only")
        val kinds = listOf(
            // the same finger, on a paragraph: the input and Compose's frame, with nothing changed
            Triple("control", "text:Hello, stranger.", Offset(6f, -4f)),
            Triple("handle", "handle", Offset(6f, -4f)),
            Triple("plane", "plane.view", Offset(-12f, 6f)),
            Triple("slider", "slider.input", Offset(56f, 0f)),
        ).filter { only == null || it.first == only || it.first == "control" }
        // each kind three times, the quietest kept: this box is shared, and other work comes and goes
        val steps = kinds.map { (kind, tag, by) ->
            List(3) { measure(page, kind, tag, { c, l -> if (kind == "slider") l + Offset(60f, 0f) else c }, by) }.minBy { it.totalMs }
        }
        if (only != null) return@runAndroidComposeUiTest
        val control = steps.first().totalMs
        val report = buildString {
            appendLine("load (IR parsed, page mounted, tree read): %.1f ms; first composition: %.1f ms; an idle step: %.2f ms".format(load, first, idle))
            for (s in steps) appendLine(s)
            for (s in steps.drop(1)) appendLine("%-8s the drag's own work on the main thread: %.2f ms a step (budget %.1f ms)".format(s.kind, s.totalMs - control, BUDGET_MS))
        }
        System.err.print(report)
        File("build/drag-perf.txt").apply { parentFile.mkdirs() }.writeText(report)
        for (s in steps.drop(1)) {
            assertTrue("${s.kind}: %.2f ms a step on the main thread, over the budget of $BUDGET_MS ms".format(s.totalMs - control), s.totalMs - control <= BUDGET_MS)
            // what the fixes do, which no load on the box changes: only the widgets that changed
            // compose again and cross from Rust, and a step is one write (and a plane's layout)
            assertTrue("${s.kind}: ${s.drawn} widgets composed a step", s.drawn <= MAX_COMPOSED)
            assertTrue("${s.kind}: ${s.sent} nodes sent a step", s.sent <= MAX_COMPOSED)
            assertTrue("${s.kind}: ${s.writes} changes in ${s.steps} steps", s.writes <= s.steps * (if (s.kind == "plane") 2 else 1) + 2)
        }
    }

    companion object {
        const val BUDGET_MS = 16.0
        const val MAX_COMPOSED = 25.0
    }
}
