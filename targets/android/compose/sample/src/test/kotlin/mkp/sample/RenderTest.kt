package mkp.sample

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runAndroidComposeUiTest
import androidx.compose.ui.unit.dp
import java.io.File
import mkp.android.CompiledPage
import mkp.android.MkpPage
import mkp.android.MkpTheme
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Pictures of the sample, to look at beside @mkp/dom's: run with `-Pmkp.render=<folder>`. A phone's
 * first screen of each tab (360 by 806 dp at density 2, as an Infinix X6516), and each page whole,
 * light and dark. Without the property it draws nothing.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class RenderTest {
    private val out = System.getProperty("mkp.render")?.let(::File)

    /** The activity's window as the screen shows it, drawn by its views on Robolectric's native
     * (Skia) canvas: captureToImage() waits for a frame the paused main looper never draws. */
    private fun shot(ui: androidx.compose.ui.test.AndroidComposeUiTest<out ComponentActivity>, crop: androidx.compose.ui.geometry.Rect? = null): Bitmap {
        lateinit var b: Bitmap
        ui.runOnUiThread {
            val v = ui.activity!!.window.decorView
            b = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(android.graphics.Canvas(b))
        }
        if (crop == null) return b
        return Bitmap.createBitmap(b, crop.left.toInt(), crop.top.toInt(), crop.width.toInt().coerceAtMost(b.width - crop.left.toInt()), crop.height.toInt().coerceAtMost(b.height - crop.top.toInt()))
    }

    private fun save(b: Bitmap, name: String) {
        out!!.mkdirs()
        File(out, "$name.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun screens(dark: Boolean) {
        assumeTrue(out != null)
        val scheme = if (dark) "dark" else "light"
        RuntimeEnvironment.setQualifiers("w360dp-h806dp-port-${if (dark) "night" else "notnight"}-xhdpi")
        runAndroidComposeUiTest<MainActivity> {
            waitForIdle()
            save(shot(this), "android-shop-screen-$scheme")
            onNode(hasText("Tour") and hasClickAction()).performClick()
            waitForIdle()
            save(shot(this), "android-tour-screen-$scheme")
        }
    }

    private fun whole(page: String, dark: Boolean) {
        assumeTrue(out != null)
        val scheme = if (dark) "dark" else "light"
        RuntimeEnvironment.setQualifiers("w360dp-h3200dp-port-${if (dark) "night" else "notnight"}-xhdpi")
        runAndroidComposeUiTest<ComponentActivity> {
            val p = CompiledPage.fromAsset(activity!!, "$page.ir.json")
            setContent {
                MaterialTheme(colorScheme = MkpTheme.colors(dark)) {
                    Box(Modifier.testTag("page").background(MaterialTheme.colorScheme.surface).padding(16.dp)) { MkpPage(p) }
                }
            }
            waitForIdle()
            val bounds = onNodeWithTag("page").fetchSemanticsNode().boundsInWindow
            save(shot(this, bounds), "android-$page-$scheme")
        }
    }

    @Test fun screensLight() = screens(false)
    @Test fun screensDark() = screens(true)
    @Test fun shopLight() = whole("shop", false)
    @Test fun shopDark() = whole("shop", true)
    @Test fun tourLight() = whole("tour", false)
    @Test fun tourDark() = whole("tour", true)
}
