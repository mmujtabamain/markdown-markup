"""What the xtmd-cli takes share: open a reel in the player, run its steps, point at what they printed.

The player (player.html) only lays out what capture.py recorded, so a take can point at a line of
real output, never write one. Every pointer below finds its line by the text xtmd printed and fails
the take when it isn't there, so a caption can't describe output that isn't on screen.
"""


class Reel:
    def __init__(self, t, name):
        self.t = t
        t.goto("/?reel=" + name, settle=1.0)
        t.page.wait_for_function("document.body.dataset.ready === '1'", timeout=20000)
        t.mark_ready()

    # ---- the page
    def card(self, hold=3.6):
        """The title card is up when the page opens; hold it, then lift it."""
        self.t.wait(hold)
        self.t.page.evaluate("xtmdv.card(false)")
        self.t.wait(0.8)

    def chapter(self, i, clear=True):
        self.hide_ring()
        self.t.page.evaluate("a => { xtmdv.chapter(a[0]); if (a[1]) xtmdv.clear(); }", [i, clear])
        self.t.wait(0.5)

    def layout(self, mode, settle=0.8):
        self.hide_ring()
        self.t.page.evaluate("m => xtmdv.layout(m)", mode)
        self.t.wait(settle)

    def hide_ring(self):
        self.t.page.evaluate("() => window.__recRing && window.__recRing(0,0,null,null)")

    # ---- commands
    def run(self, id, caption=None, after=0.4, **opts):
        """Type the step's command and print what it printed; `caption` narrates while it does."""
        self.hide_ring()
        if caption:
            self.t.hold_caption(caption)
        state = self.t.page.evaluate("a => xtmdv.play(a[0], a[1])", [id, opts])
        self.t.wait(after)
        if caption:
            self.t.release_caption()
        return state

    def answer(self, id, caption=None, after=0.4):
        """Type the answer to the question the step stopped at, and print what came next."""
        self.hide_ring()
        if caption:
            self.t.hold_caption(caption)
        state = self.t.page.evaluate("id => xtmdv.answer(id)", id)
        self.t.wait(after)
        if caption:
            self.t.release_caption()
        return state

    # ---- pointers
    def out(self, id, needle, count=1, skip=0):
        """The lines of a step's output from the one holding `needle`, `count` of them."""
        sel = self.t.page.evaluate("a => xtmdv.mark(a[0], a[1], a[2], a[3])", [id, needle, count, skip])
        if not sel:
            raise RuntimeError("step %s printed no line holding %r" % (id, needle))
        return sel

    def cmd(self, id):
        return "#c-" + id

    def exit(self, id):
        return "#x-" + id

    def file(self, id, path, when="after"):
        """Show a file as it was on disk before or after a step; changed lines are marked."""
        self.hide_ring()
        self.t.page.evaluate("a => xtmdv.show(a[0], a[1], a[2])", [id, path, when])
        self.t.wait(0.5)
        return "#filebody"

    def line(self, needle, count=1):
        """Lines of the file in the pane, from the first holding `needle` (or from line number `needle`)."""
        sel = self.t.page.evaluate("a => xtmdv.markFile(a[0], a[1])", [needle, count])
        if not sel:
            raise RuntimeError("the file shown has no line %r" % (needle,))
        return sel

    def changed(self):
        sel = self.t.page.evaluate("() => xtmdv.markChanged()")
        if not sel:
            raise RuntimeError("the file shown has no changed lines")
        return sel

    # ---- camera
    def zoom_say(self, sel, text, hold=3.2, zoom=1.35):
        """Push in on something, caption it, pull back."""
        self.t.zoom_to(sel, zoom=zoom, hold=0.5)
        self.t.say(text, hold)
        self.t.zoom_out(hold=0.3)

    def end(self, text, hold=3.0):
        self.hide_ring()
        self.t.say(text, hold)
        self.t.clear_caption()
        self.t.wait(1.0)
