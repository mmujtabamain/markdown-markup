package mkp.android

import java.math.BigDecimal
import mkp.android.ffi.Field
import mkp.android.ffi.Val
import mkp.android.widgets.SliderEnds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reading and writing values, exactly, and what a page's text may link to. */
class ValuesTest {
    private val point = Val.Record("core/point", listOf(Field("x", Val.Num("1.5")), Field("y", Val.Num("-2"))))

    @Test
    fun valuesAreWrittenInTheIrsForm() {
        assertEquals("""{"record":{"type":"core/point","fields":{"x":{"num":"1.5"},"y":{"num":"-2"}}}}""", point.toIrJson())
        assertEquals("""{"some":{"text":"a \"b\"\n"}}""", V.some(V.text("a \"b\"\n")).toIrJson())
        assertEquals("""{"none":{}}""", V.none.toIrJson())
        assertEquals("""{"case":{"enum":"core/press_kind","name":"TAB"}}""", Val.Case("core/press_kind", "TAB", emptyList(), emptyList()).toIrJson())
        assertEquals("""{"range":{"low":{"num":"0"},"high":{"num":"10"}}}""", Val.Range(listOf(Val.Num("0")), listOf(Val.Num("10")), emptyList()).toIrJson())
        assertEquals("""{"list":[{"bool":true},{"num":"3"}]}""", Val.Items(listOf(V.bool(true), V.num(3))).toIrJson())
    }

    @Test
    fun valuesAreReadThroughOpts() {
        assertEquals(XY(1.5, -2.0), V.some(point).point())
        assertEquals(1.5, point.field("x").num())
        assertNull(V.none.inner())
        assertEquals("TAB", V.some(Val.Case("core/press_kind", "TAB", emptyList(), emptyList())).case())
        // a token case's number is the build's value for it
        assertEquals(8.0, Val.Case("core/space", "M", emptyList(), listOf(Val.Num("8"))).num())
        assertTrue(V.bool(true).flag())
        assertTrue(V.none.flag(or = true))
    }

    @Test
    fun numbersAreShownAsMkpWritesThem() {
        assertEquals("3.1", V.show(BigDecimal("3.100")))
        assertEquals("0", V.show(BigDecimal("-0.000")))
        assertEquals("1000000", V.show(BigDecimal("1E+6")))
        assertEquals("0.35", V.show(V.decimal(0.35)))
    }

    @Test
    fun aSliderSnapsToItsGridExactly() {
        val e = SliderEnds(BigDecimal.ZERO, BigDecimal.TEN, BigDecimal("0.5"))
        assertEquals(BigDecimal("3.5"), e.snap(BigDecimal(3.4f.toDouble())))
        assertEquals(BigDecimal("10"), e.snap(BigDecimal("12")))
        assertEquals(BigDecimal("0"), e.snap(BigDecimal("-1")))
        assertTrue(e.has(BigDecimal("9.5")))
        assertFalse(e.has(BigDecimal("9.7")))
        assertFalse(e.has(BigDecimal("10.5")))
        // a hundredth of the way, written as a person would read it
        val hundredths = SliderEnds(BigDecimal.ZERO, BigDecimal.TEN, BigDecimal("0.1"))
        assertEquals("3.1", V.show(hundredths.snap(BigDecimal(3.1f.toDouble()))))
    }

    @Test
    fun linksAndPicturesAreCheckedFirst() {
        assertEquals("https://example.com", safeHref("https://example.com"))
        assertEquals("mailto:a@b.c", safeHref("mailto:a@b.c"))
        assertEquals("docs/a.md", safeHref("docs/a.md"))
        assertNull(safeHref("javascript:alert(1)"))
        assertNull(safeHref("java\tscript:alert(1)"))
        assertNull(safeSrc("file:///etc/passwd"))
        assertEquals("data:image/png;base64,AAAA", safeSrc("data:image/png;base64,AAAA"))
    }

    @Test
    fun texIsDrawnAsUnicodeOrAsItself() {
        assertEquals("e^(iπ)+1=0", texText("e^{i\\pi} + 1 = 0").replace(" ", ""))
        assertEquals("x²", texText("x^2"))
        assertEquals("√x", texText("\\sqrt{x}"))
        assertEquals("(n+1)⁄2", texText("\\frac{n+1}{2}"))
        assertEquals("\\unknowncommand{x}", texText("\\unknowncommand{x}"))
    }
}
