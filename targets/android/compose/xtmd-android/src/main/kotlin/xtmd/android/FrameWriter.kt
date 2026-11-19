package xtmd.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * A drag's writes: at most one a frame, and at most one in flight. Each pointer move replaces the
 * write waiting, so only the latest position is written: the first after a frame, each next one as
 * soon as the write before it is done. The write itself runs
 * off the main thread ([CompiledPage.writeAway]), so a write slower than a frame (a budget phone's
 * redraw) never holds the frames up, and moves never pile up behind it. The widget shows the drag
 * moving meanwhile on its own. [finish] runs once everything waiting has been written: a drag
 * that ends always writes where it ended.
 */
class FrameWriter internal constructor(private val scope: CoroutineScope) {
    private var waiting: (suspend () -> Unit)? = null
    private var running = false
    private val then = ArrayList<() -> Unit>()

    /** Writes [write] on the next frame (or when the write in flight is done), unless another
     * one replaces it first. */
    fun submit(write: suspend () -> Unit) {
        waiting = write
        if (running) return
        running = true
        // counted from now, not from when the coroutine starts: a test waiting for idle must not
        // slip in between
        XtmdWork.running.incrementAndGet()
        scope.launch {
            try {
                // the moves of this frame come down to the last one
                withFrameNanos { }
                // and the moves made while a write is in flight to the last of them, written as
                // soon as it is done: no frame is waited for, so nothing waits on the next frame
                // (or on a test's clock) to write where a drag ended
                while (true) {
                    val w = waiting ?: break
                    waiting = null
                    w()
                }
            } finally {
                XtmdWork.running.decrementAndGet()
                running = false
                val done = then.toList()
                then.clear()
                done.forEach { it() }
            }
        }
    }

    /** Runs [done] once everything waiting has been written (at once when nothing is). */
    fun finish(done: () -> Unit) {
        if (!running && waiting == null) done() else then += done
    }

    /** Whether a write is waiting or in flight. */
    val busy: Boolean get() = running || waiting != null
}

/** A [FrameWriter] for a composable, on its composition's frame clock. */
@Composable
fun rememberFrameWriter(): FrameWriter {
    val scope = rememberCoroutineScope()
    return remember(scope) { FrameWriter(scope) }
}
