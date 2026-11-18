package mkp.android.live

import androidx.compose.material3.ColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mkp.android.DeviceZone
import mkp.android.DocError
import mkp.android.Externs
import mkp.android.MkpDoc
import mkp.android.MkpDocState
import mkp.android.MkpTheme
import mkp.android.MkpWork
import mkp.android.Snapshot
import mkp.android.ffi.ExternCall
import mkp.android.ffi.Measure
import mkp.android.ffi.Val
import mkp.android.ffi.Zone
import mkp.android.live.ffi.Built
import mkp.android.live.ffi.Diagnostic
import mkp.android.live.ffi.NativeCompiler
import mkp.android.live.ffi.PackFile
import mkp.android.rememberMkpDocState

/**
 * MKP's real-time Android target: `MkpLiveDoc` compiles a document's text on the device as it is
 * edited, and draws it with mkp-android's `MkpDoc`. A text that compiles replaces the page, keeping
 * `$state` where its fields still exist. One that doesn't leaves the last page that did, and its
 * errors reach `onError` as [DocError.Compile] and `onDiagnostics`. When to change `source` (each
 * key, a pause, a save) is the app's.
 *
 * The compiler is in libmkp_android_live.so (mkp-live's, core compiled once for the app, the first
 * time a text is compiled). The run-time target, mkp-android, doesn't carry it.
 */

/** The app's compiler: made the first time it is asked for, off the main thread, once. */
object LiveCompiler {
    @Volatile private var made: NativeCompiler? = null

    fun get(): NativeCompiler = made ?: synchronized(this) { made ?: NativeCompiler().also { made = it } }

    /** Builds a text: on a background thread, counted as a page's work ([MkpWork]) while it runs. */
    suspend fun build(path: String, text: String, packs: List<PackFile> = emptyList()): Built =
        MkpWork.during { withContext(Dispatchers.Default) { get().build(path, text, packs) } }
}

/** A diagnostic as one line: `page.mkp.md:5:3: there is no …`. */
fun Diagnostic.located(): String = "$file:$line:$column: $message"

/**
 * An MKP document from its text. `path` names it (`page.mkp.md` for a document) in its
 * diagnostics, and `packs` are the files of the packs it uses. Everything else is `MkpDoc`'s:
 * `state` with `onStateChange` controls `$state`, `defaultState` starts the first page, `docState`
 * is the handle.
 */
@Composable
fun MkpLiveDoc(
    source: String,
    modifier: Modifier = Modifier,
    path: String = "page.mkp.md",
    packs: List<PackFile> = emptyList(),
    state: Map<String, Val>? = null,
    onStateChange: (Map<String, Val>) -> Unit = {},
    defaultState: Map<String, Val> = emptyMap(),
    defaultSnapshot: Snapshot? = null,
    width: String? = null,
    theme: String? = null,
    externs: Map<String, Map<String, Val>> = emptyMap(),
    fns: Map<String, (List<Val>) -> Val?> = emptyMap(),
    widgets: Externs = Externs.None,
    onError: (DocError) -> Unit = {},
    onDiagnostics: (List<Diagnostic>) -> Unit = {},
    onCalls: (List<ExternCall>) -> Unit = {},
    docState: MkpDocState = rememberMkpDocState(),
    measure: Measure? = null,
    colors: (dark: Boolean) -> ColorScheme = MkpTheme::colors,
    zone: Zone = DeviceZone,
    defects: List<String> = emptyList(),
) {
    // the last text that compiled, as its IR
    var ir by remember { mutableStateOf<String?>(null) }
    val latestError by rememberUpdatedState(onError)
    val latestDiagnostics by rememberUpdatedState(onDiagnostics)
    // a newer text cancels this one: its build's answer is dropped
    LaunchedEffect(source, path, packs) {
        val built = runCatching { LiveCompiler.build(path, source, packs) }.getOrElse {
            latestError(DocError.Compile("the compiler stopped on $path: ${it.message}"))
            return@LaunchedEffect
        }
        latestDiagnostics(built.diagnostics)
        val json = built.irJson
        if (json != null) ir = json
        else latestError(DocError.Compile(built.why ?: "$path doesn't compile", built.diagnostics.filter { it.severity == "error" }.map { it.located() }))
    }
    MkpDoc(
        ir = ir,
        modifier = modifier,
        state = state,
        onStateChange = onStateChange,
        defaultState = defaultState,
        defaultSnapshot = defaultSnapshot,
        width = width,
        theme = theme,
        externs = externs,
        fns = fns,
        widgets = widgets,
        onError = onError,
        onCalls = onCalls,
        docState = docState,
        measure = measure,
        colors = colors,
        zone = zone,
        defects = defects,
    )
}
