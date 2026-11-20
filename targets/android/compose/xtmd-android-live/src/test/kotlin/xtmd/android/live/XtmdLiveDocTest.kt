package xtmd.android.live

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runAndroidComposeUiTest
import java.io.File
import xtmd.android.DocError
import xtmd.android.XtmdDocState
import xtmd.android.XtmdWork
import xtmd.android.ffi.Val
import xtmd.android.live.ffi.PackFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** XtmdLiveDoc: a text compiled on the device and drawn, an edit that keeps `$state`, a broken
 * draft that leaves the last page and says why, a text that never compiled, and packs as text. */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w400dp-h1200dp-port-notnight-mdpi")
class XtmdLiveDocTest {
    private val repo = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }.first { File(it, "targets/checks").isDirectory }
    private fun testing(name: String) = File(repo, "targets/ts/bindings/testing/$name").readText()
    private val v1 by lazy { testing("counter.xtmd") }
    private val items = mapOf("app" to mapOf("unit" to Val.Text("items")))

    /** Until the compile and the page it drew are done: Compose idle and the main looper run, so
     * a compile that finished on its background thread is taken in, as xtmd-android's settle does. */
    private fun ComposeUiTest.done(what: String, until: () -> Boolean) {
        val end = System.nanoTime() + 20_000_000_000L
        while (true) {
            waitForIdle()
            if (XtmdWork.idle && until()) return
            check(System.nanoTime() < end) { "timed out waiting for $what" }
            Thread.sleep(5)
        }
    }

    @Test
    fun aTextIsCompiledDrawnAndFollowedThroughABrokenDraft() = runAndroidComposeUiTest<ComponentActivity> {
        val errors = mutableListOf<DocError>()
        var source by mutableStateOf(v1)
        val doc = XtmdDocState()
        setContent { XtmdLiveDoc(source = source, externs = items, docState = doc, onError = { errors += it }) }
        done("the first page") { doc.page != null }
        assertEquals("# Count: 0 items\n\nAdd one\n", doc.markdown())
        onNodeWithText("Add one").performClick()
        done("the click") { doc.markdown().startsWith("# Count: 1") }
        // an edit that compiles: the new page, `$state` kept
        source = testing("counter-v2.xtmd")
        done("the edit") { doc.markdown().startsWith("# Total") }
        assertTrue(doc.markdown(), doc.markdown().startsWith("# Total: 1 items, by 2"))
        // a broken draft: the last page stays, and onError says why
        source = v1.replace("# Count: \\{\$state.n}", "# Count: \\{\$state.nope}")
        done("the compile error") { errors.isNotEmpty() }
        val e = errors.single() as DocError.Compile
        assertTrue(e.message, e.message.startsWith("page.xtmd doesn't compile (1 error): page.xtmd:"))
        assertTrue(e.diagnostics.toString(), e.diagnostics.single().startsWith("page.xtmd:"))
        assertTrue(doc.markdown().startsWith("# Total: 1 items"))
        // fixed
        source = v1
        done("the fixed text") { doc.markdown().startsWith("# Count") }
        assertEquals("# Count: 1 items\n\nAdd one\n", doc.markdown())
    }

    @Test
    fun aTextThatNeverCompiledSaysWhyAndDrawsNothing() = runAndroidComposeUiTest<ComponentActivity> {
        val errors = mutableListOf<DocError>()
        val doc = XtmdDocState()
        setContent { XtmdLiveDoc(source = "\$state {\n    n: int = 0\n}\n@@@\n", docState = doc, onError = { errors += it }) }
        done("the compile error") { errors.isNotEmpty() }
        assertTrue(errors.toString(), errors.single() is DocError.Compile)
        assertNull(doc.page)
    }

    @Test
    fun packsAreGivenAsText() = runAndroidComposeUiTest<ComponentActivity> {
        val pack = PackFile("shapes/shapes.xtmdpack", "package shapes;\n\npack shapes@1 {\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n")
        val doc = XtmdDocState()
        setContent { XtmdLiveDoc(source = "import shapes;\n@@@\nTwice: \\{double(4)}\n", packs = listOf(pack), docState = doc) }
        done("the page") { doc.page != null }
        assertEquals("Twice: 8\n", doc.markdown())
    }
}
