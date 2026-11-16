package mkp.android

import androidx.activity.ComponentActivity
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsConfiguration
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.AndroidComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.click
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performMouseInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.runAndroidComposeUiTest
import androidx.compose.ui.test.swipe
import androidx.compose.ui.test.withKeysDown
import java.io.BufferedReader
import java.io.File
import java.io.FileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.PrintStream
import kotlin.system.exitProcess
import mkp.android.check.NO_COMPONENT
import mkp.android.check.NO_METHOD
import mkp.android.check.NO_PART
import mkp.android.check.Request
import mkp.android.check.Rpc
import mkp.android.check.RpcError
import mkp.android.check.STEP_FAILED
import mkp.android.check.checkPacks
import mkp.android.check.log
import mkp.android.check.settle
import mkp.android.check.waitsForMkp
import mkp.android.ffi.Node
import mkp.android.ffi.Val
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.JUnitCore
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * mkp-android's omnicui adapter: omnicui checks each core extern widget's behaviour, keyboard and
 * roles against its contract in targets/checks/contracts/ through it (target:
 * targets/checks/targets/android/target.yaml), over JSON-RPC 2.0 on standard input and output
 * (omnicui/docs/SPEC.md §4.3–4.4).
 *
 * For each `mount` it has the page written and built as the web's adapter does (page.mjs there:
 * the web's own page source, so both targets mount the same page) and draws it with MkpPage under
 * Robolectric, in a fresh activity at the viewport (mdpi: 1 dp is 1 px) and colour scheme asked
 * for (`dark` is the page theme DARK). Parts are found in the semantics tree: the widget under
 * test by its site, its parts by testTag (README: Parts). Steps are touch, mouse and key input on
 * the part's node; reads are its semantics. Events are the widget's own, through its context, and
 * each write to a `mut` input (a layout's included, when it changes the value) as `write<Input>`.
 *
 *   java @../../../android/compose/build/check_adapter.args mkp.android.OmnicuiAdapter --contracts <file>
 */
object OmnicuiAdapter {
    @JvmStatic
    fun main(args: Array<String>) {
        System.setOut(System.err)
        System.setProperty("mkp.omnicui.adapter", "1")
        val k = args.indexOf("--contracts")
        if (k >= 0 && k + 1 < args.size) System.setProperty("mkp.omnicui.contracts", args[k + 1])
        val result = JUnitCore().run(OmnicuiServe::class.java)
        for (f in result.failures) System.err.println("[android] the adapter stopped: ${f.trace}")
        exitProcess(if (result.wasSuccessful()) 0 else 1)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w320dp-h240dp-port-notnight-mdpi")
class OmnicuiServe {
    @Test
    fun serve() {
        // run by OmnicuiAdapter only: under Gradle there is nobody to talk to
        if (System.getProperty("mkp.omnicui.adapter") == null) return
        OmnicuiTarget(Rpc(FileInputStream(FileDescriptor.`in`), FileOutputStream(FileDescriptor.out))).run()
    }
}

/** page.mjs, beside target.yaml: writes and builds each mount's page. */
private class Pages {
    private val proc: Process
    private val input: PrintStream
    private val output: BufferedReader

    init {
        val here = File(System.getProperty("user.dir"))
        val script = listOf(File(here, "page.mjs"), File(here, "../../checks/targets/android/page.mjs"))
            .firstOrNull { it.exists() } ?: throw IllegalStateException("no page.mjs: run the adapter in targets/checks/targets/android")
        val args = mutableListOf("node", script.absolutePath)
        System.getProperty("mkp.omnicui.contracts")?.let { args += listOf("--contracts", it) }
        proc = ProcessBuilder(args).directory(script.parentFile).redirectError(ProcessBuilder.Redirect.INHERIT).start()
        input = PrintStream(proc.outputStream, true, "UTF-8")
        output = proc.inputStream.bufferedReader()
    }

    /** The IR of the page for a component and its props, and what its widget reports. */
    fun page(component: String, props: JSONObject): JSONObject {
        input.println(JSONObject().put("component", component).put("props", props).toString())
        val line = output.readLine() ?: throw RpcError(STEP_FAILED, "page.mjs stopped")
        val o = JSONObject(line)
        if (o.has("error")) throw RpcError(o.optInt("code", STEP_FAILED), o.getString("error"))
        return o
    }
}

private val camelRe = Regex("_([a-z0-9])")

private fun camel(s: String) = s.replace(camelRe) { it.groupValues[1].uppercase() }

private fun cap(s: String) = s.replaceFirstChar { it.uppercase() }

/** A value as an event's fields, under a name, as the web's harness writes them. */
private fun fieldsOf(name: String, v: Val?, out: MutableMap<String, Any?>): MutableMap<String, Any?> {
    when (v) {
        is Val.Num -> out[name] = v.n.toDouble().let { if (it == Math.rint(it) && kotlin.math.abs(it) < 1e15) it.toLong() else it }
        is Val.Text -> out[name] = v.s
        is Val.Bool -> out[name] = v.b
        is Val.Case -> {
            out[name] = v.name
            for (f in v.values) fieldsOf(name + cap(camel(f.name)), f.value, out)
        }
        is Val.Opt -> if (v.value.isEmpty()) out[name] = null else fieldsOf(name, v.value.first(), out)
        is Val.Record -> for (f in v.fields) fieldsOf(name + cap(camel(f.name)), f.value, out)
        null -> out[name] = null
        else -> out[name] = v.toIrJson()
    }
    return out
}

private fun find(nodes: List<Node>, test: (Node) -> Boolean): Node? {
    for (n in nodes) {
        if (test(n)) return n
        for (s in n.slots) find(s.nodes, test)?.let { return it }
    }
    return null
}

/** What a mounted widget reported since the last `events`. */
private class Recorder(val widget: String, report: JSONObject) : PageWatcher {
    var path: String? = null
    val events = mutableListOf<Map<String, Any?>>()
    private val names = report.getJSONObject("events")
    private val writes = report.getJSONObject("writes")

    override fun event(path: String, name: String, args: List<Val>) {
        if (path != this.path || !names.has(name)) return
        val e = names.getJSONObject(name)
        val params = e.getJSONArray("params")
        val fields = mutableMapOf<String, Any?>()
        for (k in 0 until params.length()) fieldsOf(camel(params.getString(k)), args.getOrNull(k), fields)
        events += mapOf("name" to e.getString("name"), "fields" to fields)
    }

    override fun write(path: String, input: String, value: Val) {
        if (path != this.path || !writes.has(input)) return
        events += mapOf("name" to writes.getString(input), "fields" to fieldsOf("value", value, mutableMapOf()))
    }

    override fun laidOut(before: List<Node>, after: List<Node>) {
        val p = path ?: return
        val was = find(before, { it.path == p })
        val now = find(after, { it.path == p }) ?: return
        for (input in writes.keys()) {
            val v = now.props[input] ?: continue
            // the layout writes every pass: only a change is a write a person could see
            if (was != null && was.props[input]?.toIrJson() == v.toIrJson()) continue
            events += mapOf("name" to writes.getString(input), "fields" to fieldsOf("value", v, mutableMapOf()))
        }
    }
}

@OptIn(ExperimentalTestApi::class)
private class OmnicuiTarget(private val rpc: Rpc) {
    private val pages = Pages()
    private var inputMode: InputModeManager? = null

    fun run() {
        var req = rpc.next()
        while (req != null) {
            val r: Request = req
            req = when (r.method) {
                "mount" -> mount(r)
                else -> {
                    answer(r) {
                        when (r.method) {
                            "advertise" -> advertise()
                            "events" -> emptyList<Any>()
                            else -> throw RpcError(if (r.method in STEPS) STEP_FAILED else NO_METHOD, if (r.method in STEPS) "${r.method}: nothing is mounted" else "unknown method ${r.method}")
                        }
                    }
                    rpc.next()
                }
            }
        }
    }

    private fun answer(r: Request, body: () -> Any?) {
        try {
            rpc.reply(r.id, body())
        } catch (e: RpcError) {
            rpc.error(r.id, e.code, e.message ?: "")
        } catch (e: Throwable) {
            log("${r.method} failed: ${e.stackTraceToString().lines().take(12).joinToString("\n")}")
            rpc.error(r.id, STEP_FAILED, e.message ?: e.toString())
        }
    }

    private fun advertise(): Map<String, Any> {
        val why = "MKP's widget contracts compare behaviour, keyboard and roles, not pixels; not implemented"
        return mapOf(
            "protocol" to "1",
            "can" to listOf("mount", "press", "focus", "key", "type", "drag", "hover", "read", "events", "bounds", "role", "focused", "selected"),
            "cannot" to mapOf(
                "screenshot" to "$why (behaviour, keyboard and roles are checked instead)",
                "probe" to "$why (no screenshots, so no render check)",
                "trace" to "$why (no motion is compared)",
                "trace.opacity" to "$why (no motion is compared)",
                "trace.scale" to "$why (no motion is compared)",
                "record" to "$why (no clips are compared)",
            ),
            "platform" to mapOf("os" to "android", "version" to "16"),
        )
    }

    private fun qualifiers(width: Int, height: Int, dark: Boolean) =
        "w${width}dp-h${height}dp-${if (width > height) "land" else "port"}-${if (dark) "night" else "notnight"}-mdpi"

    /** A fresh activity for every mount, the screen at the viewport's size, MkpPage drawing the
     * page written for the component. It serves the steps until the next mount. */
    private fun mount(req: Request): Request? {
        val p = req.params
        val component = p.optString("component")
        val built = try {
            pages.page(component, p.optJSONObject("props") ?: JSONObject())
        } catch (e: RpcError) {
            rpc.error(req.id, e.code, e.message ?: "")
            return rpc.next()
        }
        val viewport = p.optJSONObject("viewport") ?: JSONObject().put("width", 320).put("height", 240)
        val width = viewport.optInt("width", 320)
        val height = viewport.optInt("height", 240)
        val dark = p.optString("colorScheme") == "dark"
        RuntimeEnvironment.setQualifiers(qualifiers(width, height, dark))
        val recorder = Recorder("core/" + component.removePrefix("core."), built.getJSONObject("report"))
        var replied = false
        var next: Request? = null
        var ended = false
        try {
            runAndroidComposeUiTest<ComponentActivity> {
                waitsForMkp()
                val page = CompiledPage.fromJson(File(built.getString("ir")).readText(), PageOptions(theme = if (dark) "DARK" else "LIGHT", zone = UtcZone, supplies = registry.keys + checkPacks.keys))
                recorder.path = find(page.tree) { it.widget == recorder.widget }?.path
                    ?: throw RpcError(NO_COMPONENT, "${recorder.widget} is not on the page")
                page.watcher = recorder
                setContent {
                    inputMode = LocalInputModeManager.current
                    MkpPage(page, Externs(checkPacks))
                }
                settle()
                rpc.reply(req.id, null)
                replied = true
                val session = Session(this, page, recorder, component)
                while (true) {
                    val r = rpc.next()
                    if (r == null || r.method == "mount") {
                        next = r
                        ended = true
                        break
                    }
                    answer(r) { session.handle(r) }
                }
            }
        } catch (e: Throwable) {
            log("mount of $component: $e")
            if (!replied) {
                rpc.error(req.id, (e as? RpcError)?.code ?: STEP_FAILED, "mount failed: ${e.message ?: e}")
                return rpc.next()
            }
        }
        return if (ended) next else rpc.next()
    }

    private inner class Session(
        private val ui: AndroidComposeUiTest<ComponentActivity>,
        private val page: CompiledPage,
        private val recorder: Recorder,
        private val component: String,
    ) {
        private val short = component.removePrefix("core.")

        fun handle(r: Request): Any? {
            val p = r.params
            return when (r.method) {
                "advertise" -> advertise()
                "press", "focus", "key", "type", "drag", "hover" -> step(r.method, p).let { null }
                "read" -> read(p.getString("part"), p.getString("field"))
                "events" -> ArrayList(recorder.events).also { recorder.events.clear() }
                "bounds" -> bounds(p.getString("part"))
                else -> throw RpcError(NO_METHOD, "unknown method ${r.method}")
            }
        }

        // --- parts: README "Parts" ----------------------------------------------------------------

        private fun all(unmerged: Boolean, test: (SemanticsNode) -> Boolean): List<SemanticsNode> =
            ui.onAllNodes(SemanticsMatcher("part") { test(it) }, useUnmergedTree = unmerged).fetchSemanticsNodes(atLeastOneRootRequired = false)

        private fun tag(n: SemanticsNode) = n.config.getOrNull(SemanticsProperties.TestTag)

        private fun within(n: SemanticsNode, root: SemanticsNode): Boolean {
            var x: SemanticsNode? = n
            while (x != null) {
                if (x.id == root.id) return true
                x = x.parent
            }
            return false
        }

        /** The part's node: in the merged tree where it has one of its own (what assistive
         * technology reads), else the unmerged one. Placed ones first. */
        private fun locate(partId: String): SemanticsNode? {
            if (!partId.startsWith("$component.")) throw RpcError(NO_PART, "no part $partId: $component is mounted")
            val part = partId.removePrefix("$component.")
            val site = recorder.path ?: return null
            val drawn = page.native.node(site)
            fun pick(unmerged: Boolean): SemanticsNode? {
                val roots = all(unmerged) { it.config.getOrNull(MkpSite) == site }
                val root = roots.firstOrNull()
                // 1. aliases
                when {
                    short == "heading" && part.matches(Regex("level[1-6]")) ->
                        return root.takeIf { drawn?.props?.get("level").num()?.toInt() == part.last().digitToInt() }
                    short == "bullets" && (part == "ordered" || part == "unordered") ->
                        return root.takeIf { drawn?.props?.get("ordered").flag() == (part == "ordered") }
                    short == "press" && (part == "switch" || part == "checkbox") -> return root
                }
                // 2. the widget itself
                if (part == short) return root
                fun byName(name: String): List<SemanticsNode> {
                    val inside = if (root == null) emptyList() else all(unmerged) { tag(it) == "$short.$name" && within(it, root) }
                    // a popup or a dialog is a window of its own, outside the widget's root
                    return inside.ifEmpty { all(unmerged) { tag(it) == "$short.$name" } }.ifEmpty { all(unmerged) { tag(it) == name } }
                }
                // 3, 4. <short>.<part> inside it, else <part> anywhere; 5. the nth
                var found = byName(part)
                if (found.isEmpty()) {
                    val m = Regex("^(.*?)(\\d+)$").find(part)
                    if (m != null) found = listOfNotNull(byName(m.groupValues[1]).getOrNull(m.groupValues[2].toInt() - 1))
                }
                return found.firstOrNull { it.layoutInfo.isPlaced } ?: found.firstOrNull()
            }
            return pick(false) ?: pick(true)
        }

        private fun node(partId: String): Pair<SemanticsNodeInteraction, SemanticsNode> {
            val n = locate(partId) ?: throw RpcError(NO_PART, "no part $partId")
            return ui.onNode(SemanticsMatcher("node ${n.id}") { it.id == n.id }, useUnmergedTree = true) to n
        }

        // --- steps --------------------------------------------------------------------------------

        private fun onScreen(n: SemanticsNode, partId: String) {
            val b = n.boundsInRoot
            if (!n.layoutInfo.isPlaced || b.width <= 0f || b.height <= 0f) throw RpcError(STEP_FAILED, "$partId is not on screen")
        }

        fun step(method: String, p: JSONObject) {
            // a key goes wherever the focus is, as a keyboard's does
            if (method == "key") {
                val focused = ui.onAllNodes(isFocused())
                val n = if (focused.fetchSemanticsNodes(atLeastOneRootRequired = false).isNotEmpty()) focused.onFirst() else ui.onAllNodes(isRoot()).onLast()
                key(n, p.getString("key"))
                ui.settle()
                return
            }
            val partId = p.getString("part")
            val (n, node) = node(partId)
            when (method) {
                // a real touch where the part is: a disabled control takes it and does nothing
                // a mouse's click where the part is, as Playwright's: the pointer moves there, then
                // presses; a disabled control takes it and does nothing
                "press" -> {
                    onScreen(node, partId)
                    n.performMouseInput {
                        moveTo(center)
                        click(center)
                    }
                }
                // the one mouse moving over the window, from wherever it was: through the root, so
                // leaving one part for another is an exit from the first
                "hover" -> {
                    onScreen(node, partId)
                    val at = node.boundsInRoot.center
                    val root = ui.onAllNodes(isRoot()).fetchSemanticsNodes().indexOfFirst { r -> r.root == node.root }
                    if (root >= 0) ui.onAllNodes(isRoot())[root].performMouseInput { moveTo(at) } else n.performMouseInput { moveTo(center) }
                }
                "focus" -> focus(n, node, partId)
                // a letter at a time, as a person types
                "type" -> {
                    if (node.config.getOrNull(SemanticsProperties.Focused) != true) focus(n, node, partId)
                    val text = p.getString("text")
                    var k = 0
                    while (k < text.length) {
                        val end = text.offsetByCodePoints(k, 1)
                        n.performTextInput(text.substring(k, end))
                        ui.settle()
                        k = end
                    }
                }
                "drag" -> {
                    onScreen(node, partId)
                    n.performTouchInput {
                        val from = center
                        swipe(from, from + Offset(p.getDouble("dx").toFloat(), p.getDouble("dy").toFloat()), durationMillis = 200)
                    }
                }
                else -> throw RpcError(NO_METHOD, "unknown step $method")
            }
            ui.settle()
        }

        /** Keyboard focus, as a keyboard user gets it: Compose lets a clickable take focus only in
         * keyboard mode, which a hardware keyboard's first key switches to. */
        private fun focus(n: SemanticsNodeInteraction, node: SemanticsNode, partId: String) {
            val target = if (node.config.contains(SemanticsActions.RequestFocus)) node
            else node.children.firstOrNull { it.config.contains(SemanticsActions.RequestFocus) }
            // a disabled control can't take the focus, and nothing happens, as on the web
            if (target == null) {
                if (node.config.contains(SemanticsProperties.Disabled)) return
                throw RpcError(STEP_FAILED, "$partId can't take focus (no RequestFocus action)")
            }
            if (inputMode?.inputMode != InputMode.Keyboard) ui.runOnUiThread { inputMode?.requestInputMode(InputMode.Keyboard) }
            val t = if (target.id == node.id) n else ui.onNode(SemanticsMatcher("node ${target.id}") { it.id == target.id }, useUnmergedTree = true)
            t.performSemanticsAction(SemanticsActions.RequestFocus)
            ui.settle()
        }

        private fun key(n: SemanticsNodeInteraction, combo: String) {
            val names = combo.split("+")
            val keys = names.map { KEYS[it] ?: KEYS[it.uppercase()] ?: throw RpcError(STEP_FAILED, "unknown key $it in $combo") }
            n.performKeyInput { withKeysDown(keys.dropLast(1)) { pressKey(keys.last()) } }
        }

        // --- reading ------------------------------------------------------------------------------

        fun read(partId: String, field: String): Any? {
            val node = node(partId).second
            // the merged node holds what its descendants say, as assistive technology reads it
            val c = node.config
            val texts = (c.getOrNull(SemanticsProperties.Text) ?: emptyList()).joinToString(" ") { it.text }.ifEmpty {
                node.inside().mapNotNull { it.config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { t -> t.text } }.joinToString(" ")
            }
            val editable = c.getOrNull(SemanticsProperties.EditableText)?.text
            return when (field) {
                "text" -> editable ?: texts
                "name" -> c.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ") ?: texts.ifEmpty { null }
                "checked" -> c.getOrNull(SemanticsProperties.ToggleableState)?.let { it == ToggleableState.On }
                "disabled" -> c.contains(SemanticsProperties.Disabled)
                "selected" -> c.getOrNull(SemanticsProperties.Selected) ?: (c.getOrNull(SemanticsProperties.ToggleableState) == ToggleableState.On)
                "focused" -> c.getOrNull(SemanticsProperties.Focused) ?: node.inside().any { it.config.getOrNull(SemanticsProperties.Focused) == true }
                "value" -> c.getOrNull(SemanticsProperties.ProgressBarRangeInfo)?.current?.toDouble()?.let(::float32)
                "expanded" -> null
                "role" -> role(c)
                else -> throw RpcError(STEP_FAILED, "unknown field $field")
            }
        }

        private fun SemanticsNode.inside(): Sequence<SemanticsNode> = sequence {
            for (k in children) {
                yield(k)
                yieldAll(k.inside())
            }
        }

        /** Compose's role as the WAI-ARIA role a contract names. */
        private fun role(c: SemanticsConfiguration): String = when (c.getOrNull(SemanticsProperties.Role)) {
            Role.Button -> "button"
            Role.Checkbox -> "checkbox"
            Role.Switch -> "switch"
            Role.RadioButton -> "radio"
            Role.Tab -> "tab"
            Role.Image -> "img"
            Role.DropdownList -> "combobox"
            else -> when {
                c.contains(SemanticsProperties.EditableText) -> "textbox"
                c.contains(SemanticsProperties.Heading) -> "heading"
                c.contains(SemanticsProperties.ProgressBarRangeInfo) -> "slider"
                c.contains(SemanticsProperties.LiveRegion) -> "status"
                c.contains(SemanticsProperties.PaneTitle) -> "dialog"
                c.contains(SemanticsActions.OnClick) -> "button"
                else -> "generic"
            }
        }

        fun bounds(partId: String): Map<String, Double> {
            val zero = mapOf("x" to 0.0, "y" to 0.0, "width" to 0.0, "height" to 0.0)
            val node = try {
                locate(partId)
            } catch (e: RpcError) {
                throw e
            } ?: return zero
            if (!node.layoutInfo.isPlaced) return zero
            val b = node.boundsInRoot
            return mapOf("x" to b.left.toDouble(), "y" to b.top.toDouble(), "width" to b.width.toDouble(), "height" to b.height.toDouble())
        }
    }

    companion object {
        private val STEPS = setOf("press", "focus", "key", "type", "drag", "hover", "read", "bounds")

        // protocol: key names, as Playwright names them, to Compose's keys
        private val KEYS: Map<String, Key> = buildMap {
            put("Enter", Key.Enter); put("Space", Key.Spacebar); put("Tab", Key.Tab); put("Escape", Key.Escape)
            put("Backspace", Key.Backspace); put("Delete", Key.Delete); put("Home", Key.MoveHome); put("End", Key.MoveEnd)
            put("PageUp", Key.PageUp); put("PageDown", Key.PageDown)
            put("ArrowUp", Key.DirectionUp); put("ArrowDown", Key.DirectionDown); put("ArrowLeft", Key.DirectionLeft); put("ArrowRight", Key.DirectionRight)
            put("Shift", Key.ShiftLeft); put("Control", Key.CtrlLeft); put("Alt", Key.AltLeft); put("Meta", Key.MetaLeft)
            put("+", Key.Plus); put("-", Key.Minus); put("=", Key.Equals)
            put("Equal", Key.Equals); put("Minus", Key.Minus); put("Plus", Key.Plus); put("NumpadAdd", Key.NumPadAdd); put("NumpadSubtract", Key.NumPadSubtract)
            ('A'..'Z').forEach { put(it.toString(), Key(android.view.KeyEvent.KEYCODE_A + (it - 'A'))) }
            ('0'..'9').forEach { put(it.toString(), Key(android.view.KeyEvent.KEYCODE_0 + (it - '0'))) }
        }

        /** The shortest decimal that is the same float as a Compose slider's value (3.1f is 3.0999999…). */
        fun float32(n: Double): Double {
            val f = n.toFloat()
            for (p in 1..9) {
                val d = "%.${p}g".format(n).toDouble()
                if (d.toFloat() == f) return d
            }
            return n
        }
    }
}
