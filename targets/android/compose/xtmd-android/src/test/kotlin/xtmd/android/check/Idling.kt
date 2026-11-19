package xtmd.android.check

import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.IdlingResource
import xtmd.android.XtmdWork

/** Compose isn't idle while a page's work runs off the main thread (a load, a drag's write). */
@OptIn(ExperimentalTestApi::class)
fun ComposeUiTest.waitsForXtmd() = registerIdlingResource(object : IdlingResource {
    override val isIdleNow: Boolean get() = XtmdWork.idle
})

/**
 * Compose idle, and every page's work off the main thread done, with what it changed drawn.
 * Robolectric's waitForIdle doesn't wait for a registered idling resource (measured: it returned
 * while a drag's write was still in flight), so this waits for [XtmdWork] itself, the main looper
 * and Compose's clock running meanwhile so a finished write's tree is read back.
 */
@OptIn(ExperimentalTestApi::class)
fun ComposeUiTest.settle() {
    waitForIdle()
    val until = System.nanoTime() + 60_000_000_000L
    while (!XtmdWork.idle) {
        check(System.nanoTime() < until) { "the page's work off the main thread took over a minute" }
        // asleep, not polling: a drag's measured processor time stays its own
        Thread.sleep(2)
        waitForIdle()
    }
}
