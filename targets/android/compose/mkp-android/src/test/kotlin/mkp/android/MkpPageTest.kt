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
import androidx.compose.ui.test.runAndroidComposeUiTest
import java.io.File
import mkp.android.check.FixedMeasure
import mkp.android.ffi.Val
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** MkpPage drawing real pages, built by the mkp binary: the shop example and the sample's tour.
 * The widgets are driven through their semantics, as TalkBack or a test would. */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w400dp-h2000dp-port-notnight-mdpi")
class MkpPageTest {
    private val repo = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }.first { File(it, "targets/checks").isDirectory }
    private val mkp = File(repo, "targets/rust/target/release/mkp")

    /** A page's IR, as `mkp build` writes it. */
    private fun ir(source: File): String {
        assumeTrue("the mkp binary isn't built", mkp.canExecute())
        val out = File.createTempFile("mkp-page", ".ir.json")
        val p = ProcessBuilder(mkp.path, "build", source.path, "-o", out.path).redirectErrorStream(true).start()
        val log = p.inputStream.bufferedReader().readText()
        assertEquals(log, 0, p.waitFor())
        return out.readText().also { out.delete() }
    }

    private val shop by lazy { ir(File(repo, "examples/pages/shop.mkp.md")) }
    private val tour by lazy { ir(File(repo, "targets/android/compose/sample/pages/tour.mkp.md")) }

    private fun state(page: CompiledPage, name: String) = page.state(name)?.toIrJson()

    @Test
    fun theTourDrawsEveryWidgetItHas() = runAndroidComposeUiTest<ComponentActivity> {
        val page = CompiledPage.fromJson(tour, PageOptions(zone = UtcZone))
        setContent { MkpPage(page) }
        waitForIdle()
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
        val page = CompiledPage.fromJson(shop, PageOptions(zone = UtcZone))
        setContent { MkpPage(page) }
        waitForIdle()
        onNodeWithText("Check out").performClick()
        waitForIdle()
        assertEquals("{\"num\":\"1\"}", state(page, "orders"))
        val calls = page.takeCalls()
        assertEquals(1, calls.size)
        assertTrue(calls[0].name, calls[0].name.endsWith("shop.checkout"))
        assertEquals(listOf<Val>(Val.Num("36"), Val.Num("3")), calls[0].args)
        // a row's own press takes its item out
        onNodeWithText("Remove Honey").performClick()
        waitForIdle()
        assertTrue(page.markdown().contains("2 items for 18 €"))
    }

    @Test
    fun aSliderWritesExactlyAndARefusedWriteLeavesTheValue() = runAndroidComposeUiTest<ComponentActivity> {
        val page = CompiledPage.fromJson(shop, PageOptions(zone = UtcZone))
        setContent { MkpPage(page) }
        waitForIdle()
        val slider = onNode(hasContentDescription("Budget") and SemanticsMatcher.keyIsDefined(SemanticsActions.SetProgress), useUnmergedTree = true)
        slider.performSemanticsAction(SemanticsActions.SetProgress) { it(45f) }
        waitForIdle()
        assertEquals("{\"num\":\"45\"}", state(page, "budget"))
        // the basket costs 36: a budget of 30 breaks `$state`'s rule, and is undone
        slider.performSemanticsAction(SemanticsActions.SetProgress) { it(30f) }
        waitForIdle()
        assertEquals("{\"num\":\"45\"}", state(page, "budget"))
        val refused = JSONObject(page.native.observeJson(null)).getJSONObject("outcome").getJSONArray("refused")
        assertEquals("the basket fits the budget", refused.getJSONObject(0).getString("rule"))
        assertEquals(45f, slider.fetchSemanticsNode().config[SemanticsProperties.ProgressBarRangeInfo].current)
    }

    @Test
    fun aFieldWritesWhatIsTyped() = runAndroidComposeUiTest<ComponentActivity> {
        val page = CompiledPage.fromJson(tour, PageOptions(zone = UtcZone))
        setContent { MkpPage(page, measure = FixedMeasure) }
        waitForIdle()
        onNode(hasSetTextAction()).performTextReplacement("Ada")
        waitForIdle()
        assertEquals("{\"text\":\"Ada\"}", state(page, "name"))
        onNodeWithText("Hello, Ada.").assertExists()
    }

    @Test
    fun anAppsWidgetReplacesOurs() = runAndroidComposeUiTest<ComponentActivity> {
        val page = CompiledPage.fromJson(shop, PageOptions(zone = UtcZone))
        val mine = Widget { p, ctx -> Text("mine: ${p.text("value")}", Modifier.site(ctx, "label")) }
        setContent { MkpPage(page, Externs(mapOf("core/label" to mine))) }
        waitForIdle()
        onNodeWithText("mine: Tea: 12 €").assertExists()
    }

    @Test
    fun theAppsWritesAreChecked() = runAndroidComposeUiTest<ComponentActivity> {
        val page = CompiledPage.fromJson(shop, PageOptions(zone = UtcZone, state = mapOf("budget" to Val.Num("80"))))
        setContent { MkpPage(page) }
        waitForIdle()
        assertEquals("{\"num\":\"80\"}", state(page, "budget"))
        page.set("budget" to Val.Num("120"))
        waitForIdle()
        assertEquals("{\"num\":\"80\"}", state(page, "budget"))
        page.setPage(null, "DARK")
        waitForIdle()
        assertEquals("DARK", page.theme)
    }
}
