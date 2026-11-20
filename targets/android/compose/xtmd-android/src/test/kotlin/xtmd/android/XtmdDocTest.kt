package xtmd.android

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runAndroidComposeUiTest
import java.io.File
import xtmd.android.check.settle
import xtmd.android.check.waitsForXtmd
import xtmd.android.ffi.Val
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** XtmdDoc, the Android run-time target, on the pages the web targets' tests use
 * (targets/ts/bindings/testing): a starting `$state` checked, `$state` controlled by the app,
 * the handle, snapshots, a new IR, the app's value fns, and an IR that can't be had. */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w400dp-h1200dp-port-notnight-mdpi")
class XtmdDocTest {
    private val repo = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }.first { File(it, "targets/checks").isDirectory }
    private val xtmd = File(repo, "targets/rust/target/release/xtmd")

    private fun build(source: File): String {
        assumeTrue("the xtmd binary isn't built", xtmd.canExecute())
        val out = File.createTempFile("xtmd-doc", ".ir.json")
        val p = ProcessBuilder(xtmd.path, "build", source.path, "--out", out.path).redirectErrorStream(true).start()
        val log = p.inputStream.bufferedReader().readText()
        assertEquals(log, 0, p.waitFor())
        return out.readText().also { out.delete() }
    }

    private fun testing(name: String) = build(File(repo, "targets/ts/bindings/testing/$name"))
    private val v1 by lazy { testing("counter.xtmd") }
    private val v2 by lazy { testing("counter-v2.xtmd") }
    private val notes by lazy { testing("notes.xtmd") }
    private val items = mapOf("app" to mapOf("unit" to Val.Text("items")))
    private fun num(n: Int) = Val.Num(n.toString())

    @Test
    fun aDocumentDrawsFromTheStateItStartsFromChecked() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForXtmd()
        val errors = mutableListOf<DocError>()
        val doc = XtmdDocState()
        val bad = XtmdDocState()
        setContent {
            XtmdDoc(ir = v1, defaultState = mapOf("n" to num(2)), externs = items, docState = doc, onError = { errors += it })
            XtmdDoc(ir = v1, defaultState = mapOf("n" to num(11)), externs = items, docState = bad, onError = { errors += it })
        }
        settle()
        assertEquals("# Count: 2 items\n\nAdd one\n", doc.markdown())
        // one that doesn't fit: refused, and the page starts from its default
        assertEquals(1, errors.size)
        assertEquals("\$state.n", (errors[0] as DocError.Refused).broken.site)
        assertEquals(mapOf("n" to num(0)), bad.state())
    }

    @Test
    fun aControlledStateIsWrittenCheckedAndFollowsThePage() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForXtmd()
        val errors = mutableListOf<DocError>()
        val calls = mutableListOf<String>()
        var app by mutableStateOf<Map<String, Val>>(mapOf("n" to num(0)))
        val doc = XtmdDocState()
        setContent {
            XtmdDoc(ir = v1, state = app, onStateChange = { app = it }, externs = items, docState = doc, onError = { errors += it }, onCalls = { c -> calls += c.map { it.name } })
        }
        settle()
        // a reader's press: the page changes, the app hears it, and the extern fn it called
        onNodeWithText("Add one").performClick()
        settle()
        assertEquals(mapOf("n" to num(1)), app)
        assertEquals(listOf("doc/app.saved"), calls)
        // the app's: written, or refused and the page keeps the last that fit
        app = mapOf("n" to num(20))
        settle()
        assertTrue(errors.toString(), errors.single() is DocError.Refused)
        assertEquals("# Count: 1 items\n\nAdd one\n", doc.markdown())
        app = mapOf("n" to num(4))
        settle()
        assertEquals("# Count: 4 items\n\nAdd one\n", doc.markdown())
    }

    @Test
    fun theHandleWritesExposesAndReadsThePage() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForXtmd()
        val errors = mutableListOf<DocError>()
        var unit by mutableStateOf("items")
        val doc = XtmdDocState()
        setContent {
            XtmdDoc(ir = v1, externs = mapOf("app" to mapOf("unit" to Val.Text(unit))), docState = doc, onError = { errors += it })
        }
        settle()
        doc.set("n" to num(20))
        settle()
        assertTrue(errors.toString(), (errors.single() as DocError.Refused).broken.code == "contracts.outside")
        doc.set("n" to num(3))
        unit = "pts"
        settle()
        assertEquals("# Count: 3 pts\n\nAdd one\n", doc.markdown())
        doc.expose("app", "reset")
        settle()
        assertEquals(mapOf("n" to num(0)), doc.state())
    }

    @Test
    fun aSnapshotBringsBackStateAndWidgetsOwnVariables() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForXtmd()
        var which by mutableStateOf(notes)
        val doc = XtmdDocState()
        setContent { XtmdDoc(ir = which, externs = items, docState = doc) }
        settle()
        doc.set("n" to num(2))
        onNodeWithText("More Apples").performClick()
        onNodeWithText("More Apples").performClick()
        settle()
        assertTrue(doc.markdown(), doc.markdown().contains("Apples: 2"))
        val snap = Snapshot.fromJson(doc.snapshot()!!.toJson())!!
        assertTrue(snap.ownJson, snap.ownJson.contains("\"k\":{\"num\":\"2\"}"))
        onNodeWithText("More Apples").performClick()
        settle()
        val all = doc.restore(snap)
        settle()
        assertEquals(Restored(Restored.How.ALL, emptyList()), all)
        assertTrue(doc.markdown(), doc.markdown().contains("Apples: 2") && doc.markdown().contains("# Notes: 2"))
        // another IR: `$state` only
        which = v1
        settle()
        assertEquals(Restored(Restored.How.STATE, listOf("own")), doc.restore(snap))
        settle()
        assertEquals(mapOf("n" to num(2)), doc.state())
        assertEquals(Restored.How.NONE, doc.restore(snap.copy(xtmd = "0.2.0")).restored)
        assertEquals(Restored.How.NONE, doc.restore(snap.copy(stateJson = "{\"n\":{\"num\":\"11\"}}")).restored)
    }

    @Test
    fun aNewIrKeepsTheStateWhoseFieldsItStillHas() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForXtmd()
        var which by mutableStateOf(v1)
        val doc = XtmdDocState()
        setContent { XtmdDoc(ir = which, externs = items, docState = doc) }
        settle()
        doc.set("n" to num(3))
        which = v2
        settle()
        assertEquals(mapOf("n" to num(3), "stride" to num(2)), doc.state())
        assertTrue(doc.markdown(), doc.markdown().startsWith("# Total: 3 items, by 2"))
    }

    @Test
    fun theAppsValueFnsAreCalled() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForXtmd()
        val page = File.createTempFile("xtmd-fns", ".xtmd").apply { writeText("let at: moment = \"2026-11-16T23:30+00:00\";\n@@@\nLocal: \\{at.local()}\n") }
        val ir = build(page)
        val doc = XtmdDocState()
        val asked = mutableListOf<String>()
        // the app's own zone: two hours east, whatever the device's
        setContent {
            XtmdDoc(ir = ir, docState = doc, fns = mapOf("core/moment.local" to { args ->
                asked += args.map { it.toString() }
                val m = args.single() as Val.Record
                Val.Record(m.ty, m.fields.map { f -> if (f.name == "hour") f.copy(value = Val.Num("1")) else f })
            }))
        }
        settle()
        assertTrue(asked.isNotEmpty())
        assertTrue(doc.markdown(), doc.markdown().contains("T01:30"))
    }

    @Test
    fun anIrThatCantBeHadSaysWhy() = runAndroidComposeUiTest<ComponentActivity> {
        waitsForXtmd()
        val errors = mutableListOf<DocError>()
        val doc = XtmdDocState()
        setContent {
            XtmdDoc(src = "no-such-page.ir.json", docState = doc, onError = { errors += it })
            XtmdDoc(ir = "{}", onError = { errors += it })
        }
        settle()
        val messages = errors.map { (it as DocError.Load).message }
        assertTrue(messages.toString(), messages.any { it.startsWith("the page at no-such-page.ir.json couldn't be loaded") })
        assertTrue(messages.toString(), messages.any { it.startsWith("the page couldn't start") })
        assertEquals(null, doc.page)
        assertNotNull(errors)
    }
}
