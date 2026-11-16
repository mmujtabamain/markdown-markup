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
        onNodeWithTag("heading").assertExists()
        onNodeWithText("Check out").performClick()
        waitForIdle()
        onNodeWithText("Orders placed: 1.", substring = true).assertExists()
        onNode(hasText("Tour") and hasClickAction()).performClick()
        waitForIdle()
        onNodeWithText("A tour of MKP on Android").assertExists()
        onNodeWithText("Show the details").performClick()
        waitForIdle()
        onNodeWithText("Size M, level 4, 1 of 2 done.", useUnmergedTree = true).assertExists()
    }
}
