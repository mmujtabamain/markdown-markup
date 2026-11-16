package mkp.android

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** tokens.mkp, beside target.yaml, says the colours mkp-android draws core's tokens with: they are
 * the Material 3 baseline's, which MkpTheme gives, so the file and the code can't drift apart. */
class TokensTest {
    private val file = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .map { File(it, "tokens.mkp") }.first { it.exists() }

    private fun tokens(): Map<String, Pair<String, String>> =
        Regex("""color\.(\w+) = color_value \{ light = "(#\w+)", dark = "(#\w+)" \}""").findAll(file.readText())
            .associate { it.groupValues[1] to (it.groupValues[2] to it.groupValues[3]) }

    @Test
    fun theColoursAreMaterial3s() {
        val light = lightColorScheme()
        val dark = darkColorScheme()
        val roles = mapOf(
            "SURFACE" to (light.surface to dark.surface),
            "INK" to (light.onSurface to dark.onSurface),
            "MUTED" to (light.onSurfaceVariant to dark.onSurfaceVariant),
            "LINE" to (light.outlineVariant to dark.outlineVariant),
            "ACCENT" to (light.primary to dark.primary),
            "BAD" to (light.error to dark.error),
        )
        val t = tokens()
        assertEquals(roles.keys, t.keys)
        for ((name, scheme) in roles) {
            assertEquals("color.$name light", scheme.first, hex(t.getValue(name).first))
            assertEquals("color.$name dark", scheme.second, hex(t.getValue(name).second))
        }
    }

    @Test
    fun hexColoursReadWithTheirAlpha() {
        assertEquals(Color(0xFF2563EB), hex("#2563eb"))
        assertEquals(Color(0x1F000000), hex("#0000001f"))
        assertTrue(hex("blue") == null)
    }
}
