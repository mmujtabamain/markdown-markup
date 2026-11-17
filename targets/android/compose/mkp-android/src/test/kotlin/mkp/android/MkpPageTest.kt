package mkp.android

import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.runAndroidComposeUiTest
import java.io.File
import mkp.android.check.FixedMeasure
import mkp.android.check.settle
import mkp.android.check.waitsForMkp
import androidx.compose.ui.geometry.Offset
import mkp.android.ffi.Val
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** MkpPage drawing real pages, built by the mkp binary: the shop example and the sample's tour.
 * The widgets are driven through their semantics, as TalkBack or a test would. */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE) // real text measuring (Skia), so widths are a phone's
@Config(sdk = [36], qualifiers = "w400dp-h2000dp-port-notnight-mdpi")
class MkpPageTest {
    private val repo = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }.first { File(it, "targets/checks").isDirectory }
    private val mkp = File(repo, "targets/rust/target/release/mkp")

    /** A page's IR, as `mkp build` writes it. */
    private fun ir(source: File): String {
        assumeTrue("the mkp binary isn't built", mkp.canExecute())
        val out = File.createTempFile("mkp-page", ".ir.json")
        val p = ProcessBuilder(mkp.path, "build", source.path, "--out", out.path).redirectErrorStream(true).start()
        val log = p.inputStream.bufferedReader().readText()
        assertEquals(log, 0, p.waitFor())
        return out.readText().also { out.delete() }
    }

    private val shop by lazy { ir(File(repo, "examples/pages/shop.mkp.md")) }
    private val tour by lazy { ir(File(repo, "targets/android/compose/sample/pages/tour.mkp.md")) }

    private fun state(page: CompiledPage, name: String) = page.state(name)?.toIrJson()

    @Test
    fun theTourDrawsEveryWidgetItHas() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val page = CompiledPage.fromJson(tour, PageOptions(zone = UtcZone))
        setContent { MkpPage(page) }
        settle()
        assertEquals(emptyList<String>(), page.missing)
        val tree = JSONObject(page.native.observeJson(null)).getJSONObject("tree")
        val widgets = tree.keys().asSequence().map { tree.getJSONObject(it).getString("widget") }.toSet()
        for (w in listOf("core/heading", "core/paragraph", "core/bullets", "core/item", "core/quote", "core/code", "core/math", "core/table", "core/divider",
            "core/field", "core/slider", "core/press", "core/icon", "core/overlay", "core/grid", "core/cell", "core/canvas", "core/layer", "core/circle",
            "core/path", "core/handle", "core/place", "core/shade", "core/plane", "core/spot", "core/label", "core/flex")) {
            assertTrue("the tour has a $w", w in widgets)
        }
        // everything in the tree is drawn: a closed overlay's body too, hidden
        assertEquals(tree.keys().asSequence().toSet(), page.drawn)
        // and the plane's note was laid out from Compose's own measure
        assertTrue(state(page, "note")!!.startsWith("{\"some\""))
    }

    @Test
    fun aPressRunsItsHandlerAndTheAppHearsItsCall() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val page = CompiledPage.fromJson(shop, PageOptions(zone = UtcZone))
        setContent { MkpPage(page) }
        settle()
        onNodeWithText("Check out").performClick()
        settle()
        assertEquals("{\"num\":\"1\"}", state(page, "orders"))
        val calls = page.takeCalls()
        assertEquals(1, calls.size)
        assertTrue(calls[0].name, calls[0].name.endsWith("shop.checkout"))
        assertEquals(listOf<Val>(Val.Num("36"), Val.Num("3")), calls[0].args)
        // a row's own press takes its item out
        onNodeWithText("Remove Honey").performClick()
        settle()
        assertTrue(page.markdown().contains("2 items for 18 €"))
    }

    @Test
    fun aSliderWritesExactlyAndARefusedWriteLeavesTheValue() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val page = CompiledPage.fromJson(shop, PageOptions(zone = UtcZone))
        setContent { MkpPage(page) }
        settle()
        val slider = onNode(hasContentDescription("Budget") and SemanticsMatcher.keyIsDefined(SemanticsActions.SetProgress), useUnmergedTree = true)
        slider.performSemanticsAction(SemanticsActions.SetProgress) { it(45f) }
        settle()
        assertEquals("{\"num\":\"45\"}", state(page, "budget"))
        // the basket costs 36: a budget of 30 breaks `$state`'s rule, and is undone
        slider.performSemanticsAction(SemanticsActions.SetProgress) { it(30f) }
        settle()
        assertEquals("{\"num\":\"45\"}", state(page, "budget"))
        val refused = JSONObject(page.native.observeJson(null)).getJSONObject("outcome").getJSONArray("refused")
        assertEquals("the basket fits the budget", refused.getJSONObject(0).getString("rule"))
        assertEquals(45f, slider.fetchSemanticsNode().config[SemanticsProperties.ProgressBarRangeInfo].current)
    }

    @Test
    fun aFieldWritesWhatIsTyped() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val page = CompiledPage.fromJson(tour, PageOptions(zone = UtcZone))
        setContent { MkpPage(page, measure = FixedMeasure) }
        settle()
        onNode(hasSetTextAction()).performTextReplacement("Ada")
        settle()
        assertEquals("{\"text\":\"Ada\"}", state(page, "name"))
        onNodeWithText("Hello, Ada.").assertExists()
    }

    @Test
    fun aLongCodeLineScrollsAndEndsWithoutAnEmptyLine() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val page = CompiledPage.fromJson(tour, PageOptions(zone = UtcZone))
        setContent { MkpPage(page, measure = FixedMeasure) }
        settle()
        val code = onNode(SemanticsMatcher.expectValue(SemanticsProperties.TestTag, "code.text"), useUnmergedTree = true)
        // the source's last line break ends its line: no empty line under it
        assertEquals(1, code.fetchSemanticsNode().config[SemanticsProperties.Text].first().text.lines().size)
        val before = code.fetchSemanticsNode().boundsInRoot.left
        // a finger across the block, which is as wide as the page
        onNode(SemanticsMatcher.expectValue(SemanticsProperties.TestTag, "code"), useUnmergedTree = true).performTouchInput { swipeLeft() }
        settle()
        assertTrue("it scrolls sideways", code.fetchSemanticsNode().boundsInRoot.left < before)
    }

    @Test
    fun aDragThatEndsWhileAWriteIsInFlightWritesWhereItEnded() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val page = CompiledPage.fromJson(tour, PageOptions(zone = UtcZone))
        val writes = mutableListOf<Val>()
        page.watcher = object : PageWatcher {
            override fun write(path: String, input: String, value: Val) {
                if (input == "at") writes += value
            }
        }
        setContent { MkpPage(page, measure = FixedMeasure) }
        settle()
        fun bounds(tag: String) = onNode(SemanticsMatcher.expectValue(SemanticsProperties.TestTag, tag), useUnmergedTree = true).fetchSemanticsNode().boundsInWindow
        val surface = bounds("canvas.surface")
        val start = bounds("handle").center
        val view = activity!!.window.decorView
        var time = android.os.SystemClock.uptimeMillis()
        val downTime = time
        fun send(action: Int, at: Offset) {
            time += 8
            val e = android.view.MotionEvent.obtain(downTime, time, action, at.x, at.y, 0)
            runOnUiThread { view.dispatchTouchEvent(e) }
            e.recycle()
        }
        // the page held by a long call on another thread (a big shade's pixels): a write started
        // now waits for it, in flight, while the finger goes on and lifts
        val shade = page.tree.let { t ->
            fun find(ns: List<mkp.android.ffi.Node>): mkp.android.ffi.Node? = ns.firstNotNullOfOrNull { n -> if (n.widget == "core/shade") n else find(n.slots.flatMap { it.nodes }) }
            find(t)!!
        }
        val holder = Thread { page.native.shade(shade.path, 160u, 160u) }
        send(android.view.MotionEvent.ACTION_DOWN, start)
        send(android.view.MotionEvent.ACTION_MOVE, start + Offset(20f, -10f))
        holder.start()
        Thread.sleep(50)
        // a frame: the first write starts, and waits for the page
        mainClock.advanceTimeByFrame()
        send(android.view.MotionEvent.ACTION_MOVE, start + Offset(30f, -20f))
        val end = start + Offset(42f, -31f)
        send(android.view.MotionEvent.ACTION_MOVE, start + Offset(40f, -30f))
        // the lift is a little further on than the last move
        send(android.view.MotionEvent.ACTION_UP, end)
        assertTrue("a write was in flight when the drag ended", !MkpWork.idle && holder.isAlive)
        settle()
        holder.join()
        // the canvas is -1..1 across and up, 320 dp wide at an aspect of 1.5 (its height a fraction
        // the laid-out box rounds); one dp is 2/320 units, kept to 4 places
        val w = surface.width
        val h = w / 1.5f
        fun units(x: Float, y: Float) = "{\"record\":{\"type\":\"core/point\",\"fields\":{\"x\":{\"num\":\"%s\"},\"y\":{\"num\":\"%s\"}}}}".format(
            V.show(V.decimal(-1.0 + (x - surface.left) / w * 2.0, 4)), V.show(V.decimal(1.0 - (y - surface.top) / h * 2.0, 4)))
        assertEquals(units(end.x, end.y), writes.last().toIrJson())
        assertEquals(units(end.x, end.y), state(page, "p"))
        assertTrue("fewer writes than moves: ${writes.size}", writes.size in 2..3)
    }

    @Test
    fun anAppsWidgetReplacesOurs() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val page = CompiledPage.fromJson(shop, PageOptions(zone = UtcZone))
        val mine = Widget { p, ctx -> Text("mine: ${p.text("value")}", Modifier.site(ctx, "label")) }
        setContent { MkpPage(page, Externs(mapOf("core/label" to mine))) }
        settle()
        onNodeWithText("mine: Tea: 12 €").assertExists()
    }

    @Test
    fun theAppsWritesAreChecked() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForMkp()
        val page = CompiledPage.fromJson(shop, PageOptions(zone = UtcZone, state = mapOf("budget" to Val.Num("80"))))
        setContent { MkpPage(page) }
        settle()
        assertEquals("{\"num\":\"80\"}", state(page, "budget"))
        page.set("budget" to Val.Num("120"))
        settle()
        assertEquals("{\"num\":\"80\"}", state(page, "budget"))
        page.setPage(null, "DARK")
        settle()
        assertEquals("DARK", page.theme)
    }
}
