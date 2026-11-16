package mkp.sample

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runAndroidComposeUiTest
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The sample as it starts on a phone: its activity, its pages from its assets, its tabs. */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp-port-notnight-xxhdpi")
class SampleAppTest {
    @Test
    fun bothPagesShowAndTheShopChecksOut() = runAndroidComposeUiTest<MainActivity> {
            registerIdlingResource(object : androidx.compose.ui.test.IdlingResource { override val isIdleNow get() = mkp.android.MkpWork.idle })
        onNodeWithTag("heading").assertExists()
        onNodeWithText("Check out").performClick()
        settle()
        onNodeWithText("Orders placed: 1.", substring = true).assertExists()
        onNode(hasText("Tour") and hasClickAction()).performClick()
        settle()
        onNodeWithText("A tour of MKP on Android").assertExists()
        onNodeWithText("Show the details").performClick()
        settle()
        onNodeWithText("Size M, level 4, 1 of 2 done.", useUnmergedTree = true).assertExists()
    }
}

/** Compose idle, and every page's work off the main thread done (Robolectric's waitForIdle doesn't
 * wait for a registered idling resource). */
@OptIn(ExperimentalTestApi::class)
private fun androidx.compose.ui.test.ComposeUiTest.settle() {
    waitForIdle()
    val until = System.nanoTime() + 60_000_000_000L
    while (!mkp.android.MkpWork.idle) {
        check(System.nanoTime() < until) { "the page's work off the main thread took over a minute" }
        // asleep, not polling: a drag's measured processor time stays its own
        Thread.sleep(2)
        waitForIdle()
    }
}
