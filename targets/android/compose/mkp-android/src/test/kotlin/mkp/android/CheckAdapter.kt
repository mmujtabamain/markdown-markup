package mkp.android

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.AndroidComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.runAndroidComposeUiTest
import java.io.File
import java.io.FileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.math.BigDecimal
import kotlin.system.exitProcess
import mkp.android.check.FAILED
import mkp.android.check.FixedMeasure
import mkp.android.check.NO_METHOD
import mkp.android.check.Request
import mkp.android.check.Rpc
import mkp.android.check.RpcError
import mkp.android.check.checkPacks
import mkp.android.check.clickable
import mkp.android.check.interaction
import mkp.android.check.log
import mkp.android.check.part
import mkp.android.check.settle
import mkp.android.check.waitsForMkp
import mkp.android.check.widgetAt
import mkp.android.check.withAction
import mkp.android.ffi.Val
import mkp.android.widgets.sliderEnds
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.JUnitCore
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Android target's check adapter: `mkp target check android` (target.yaml) drives mkp-android
 * through it over JSON-RPC 2.0, one message per line on standard input and output (plan tab 16).
 * Pages are drawn by MkpPage with our default Compose widgets, under Robolectric on a plain JVM,
 * so the checks need no emulator. Each step goes through the drawn widgets' own semantics where
 * it can (a press's click action, a slider's progress, a field's text, an overlay's anchor), as a
 * person would through TalkBack or a keyboard, and through the page where it can't (an exact point
 * for a handle or a plane); then Compose settles, the planes are laid out with the checks' fixed
 * sizes, and the observation is what the runtime decided, with the tree only what Compose drew.
 *
 * `java @build/check_adapter.args mkp.android.CheckAdapter`: build/check_adapter.args is written
 * by `./gradlew :mkp-android:checkAdapterArgs` (README.md).
 */
object CheckAdapter {
    @JvmStatic
    fun main(args: Array<String>) {
        // standard output carries replies only: Robolectric's and Compose's logs go to standard error
        System.setOut(System.err)
        val started = System.nanoTime()
        val result = JUnitCore().run(CheckServe::class.java)
        for (f in result.failures) System.err.println("[android] the adapter stopped: ${f.trace}")
        System.err.println("[android] served for %.1f s".format((System.nanoTime() - started) / 1e9))
        exitProcess(if (result.wasSuccessful()) 0 else 1)
    }
}

/** The Robolectric sandbox the adapter runs in, for the whole conversation: Android 16, an mdpi
 * screen 640 dp wide (1 dp is 1 px), as the web target's page is 640 CSS pixels wide. Under
 * Gradle (`./gradlew testDebugUnitTest`) standard input is empty, so it returns at once. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w640dp-h1200dp-port-notnight-mdpi")
class CheckServe {
    @Test
    fun serve() {
        CheckSession(Rpc(FileInputStream(FileDescriptor.`in`), FileOutputStream(FileDescriptor.out))).run()
    }
}

/** The page loaded now, and MkpPage drawing it. */
@OptIn(ExperimentalTestApi::class)
class CheckSession(private val rpc: Rpc) {
    private val defects = (System.getenv("MKP_TEST_DEFECT") ?: "").split(",").filter { it.isNotEmpty() }
    private var page: CompiledPage? = null

    fun run() {
        runAndroidComposeUiTest<ComponentActivity> {
            waitsForMkp()
            var shown by mutableStateOf<CompiledPage?>(null)
            setContent {
                shown?.let { p -> key(p) { MkpPage(p, Externs(checkPacks), measure = FixedMeasure) } }
            }
            settle()
            while (true) {
                val r = rpc.next() ?: break
                val loaded = page
                try {
                    when (r.method) {
                        "advertise" -> rpc.reply(r.id, advertise())
                        "quit" -> {
                            rpc.reply(r.id, emptyMap<String, Any>())
                            return@runAndroidComposeUiTest
                        }
                        "load" -> {
                            val p = load(r.params)
                            page = p
                            shown = p
                            settle()
                            rpc.reply(r.id, emptyMap<String, Any>())
                        }
                        "event", "write", "set", "expose", "extern", "page", "observe" -> {
                            if (loaded == null) throw RpcError(FAILED, "no page is loaded")
                            if (r.method == "observe") {
                                settle()
                                rpc.replyRaw(r.id, loaded.native.observeJson(loaded.drawn.toList()))
                            } else {
                                step(this, loaded, r)
                                settle()
                                rpc.reply(r.id, emptyMap<String, Any>())
                            }
                        }
                        else -> rpc.error(r.id, NO_METHOD, "no method ${r.method}")
                    }
                } catch (e: RpcError) {
                    rpc.error(r.id, e.code, e.message ?: "")
                } catch (e: Throwable) {
                    log("${r.method}: ${e.stackTraceToString().lines().take(14).joinToString("\n")}")
                    rpc.error(r.id, FAILED, e.message ?: e.toString())
                }
            }
        }
    }

    private fun advertise() = mapOf(
        "name" to "android",
        "protocol" to "1",
        "levels" to listOf("core.draw", "core.live", "core.gfx"),
        "supplies" to listOf("core/*", "core/can_draw_tex", "core/moment.local"),
    )

    private fun load(p: JSONObject): CompiledPage {
        val ir = File(p.getString("ir")).readText()
        val values = p.optJSONObject("page") ?: JSONObject()
        val ignores = "ignores-page" in defects
        val supplies = (registry.keys + checkPacks.keys).toList()
        val init = mkp.android.ffi.PageInit(
            width = if (ignores) null else values.optString("width").ifEmpty { null },
            theme = if (ignores) null else values.optString("theme").ifEmpty { null },
            stateJson = p.optJSONObject("state")?.toString(),
            externsJson = p.optJSONObject("externs")?.toString(),
            supplies = supplies,
            defects = defects,
        )
        return CompiledPage(mkp.android.ffi.NativePage(ir, init, UtcZone), supplies, init.theme)
    }

    /** One step: through the drawn widget's semantics where it can, else through the page. */
    private fun step(ui: AndroidComposeUiTest<ComponentActivity>, page: CompiledPage, r: Request) {
        val p = r.params
        val n = page.native
        when (r.method) {
            "event" -> {
                val site = p.getString("site")
                val name = p.getString("name")
                val args = p.optJSONArray("args") ?: JSONArray()
                if (args.length() == 0 && byWidget(ui, page, site, name)) return
                page.change { it.eventJson(site, name, args.toString()) }
            }
            "write" -> {
                val site = p.getString("site")
                val input = p.getString("input")
                val value = p.get("value").toString()
                if (writeByWidget(ui, page, site, input, n.valueJson(value))) return
                page.change { it.writeJson(site, input, value) }
            }
            "set" -> page.change { it.setJson((p.optJSONObject("\$state") ?: JSONObject()).toString()) }
            "expose" -> page.change { it.exposeJson(p.getString("channel"), p.getString("name"), (p.optJSONArray("args") ?: JSONArray()).toString()) }
            "extern" -> page.change { it.externJson(p.getString("channel"), (p.optJSONObject("values") ?: JSONObject()).toString()) }
            "page" -> {
                if ("ignores-page" in defects) return
                val v = p.optJSONObject("page") ?: JSONObject()
                page.setPage(v.optString("width").ifEmpty { null }, v.optString("theme").ifEmpty { null })
            }
        }
    }

    /** An event with no arguments, through the widget: a click is its click action, a submit its
     * IME action. False when the widget can't do it that way (it doesn't listen, or isn't drawn). */
    private fun byWidget(ui: AndroidComposeUiTest<ComponentActivity>, page: CompiledPage, site: String, name: String): Boolean {
        val w = ui.widgetAt(site) ?: return false
        val node = page.native.node(site) ?: return false
        when (name) {
            "click" -> {
                if (node.widget == "core/canvas" || node.widget == "core/plane") return false
                val target = w.clickable() ?: return false
                ui.interaction(target).performSemanticsAction(SemanticsActions.OnClick)
                return true
            }
            "submit" -> {
                val input = w.part("field.input") ?: return false
                if (node.props["lines"].num()?.let { it > 1 } == true) return false
                ui.interaction(input).performImeAction()
                return true
            }
        }
        return false
    }

    /** A write, through the widget where a person could make it. */
    private fun writeByWidget(ui: AndroidComposeUiTest<ComponentActivity>, page: CompiledPage, site: String, input: String, value: Val): Boolean {
        val w = ui.widgetAt(site) ?: return false
        val node = page.native.node(site) ?: return false
        when {
            node.widget == "core/slider" && input == "value" && value is Val.Num -> {
                // only what a drag can reach: on the grid, between the ends
                val x = BigDecimal(value.n)
                val ctx = page.native.sliderEnds(site)
                val ends = mkp.android.widgets.SliderEnds(BigDecimal(ctx.low), BigDecimal(ctx.high), BigDecimal(ctx.step))
                if (!ends.has(x)) return false
                if (node.props["disabled"].flag()) return true
                val slider = w.part("slider.input")?.withSetProgress() ?: return false
                ui.interaction(slider).performSemanticsAction(SemanticsActions.SetProgress) { it(x.toFloat()) }
                return true
            }
            node.widget == "core/field" && input == "value" && value is Val.Text -> {
                // a one-line field can't hold a line break: that write goes through the page
                val one = (node.props["lines"].num() ?: 1.0) <= 1.0
                if (one && (value.s.contains('\n') || value.s.contains('\r'))) return false
                val field = w.part("field.input") ?: return false
                ui.interaction(field).performTextReplacement(value.s)
                return true
            }
            node.widget == "core/overlay" && input == "open" && value is Val.Bool -> {
                if (node.props["open"].flag() == value.b) return true
                if (node.props["mode"].case() == "TOOLTIP") return false
                val anchor = w.part("overlay.anchor") ?: return false
                // its anchor's own control, or the anchor itself: a press opens it, or closes it
                val trigger = anchor.clickable() ?: return false
                ui.interaction(trigger).performSemanticsAction(SemanticsActions.OnClick)
                return true
            }
        }
        return false
    }

    private fun androidx.compose.ui.semantics.SemanticsNode.withSetProgress() =
        withAction(SemanticsActions.SetProgress)
}
