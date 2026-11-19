"""A framework's two kinds of target, in React: the same Extended Mark page drawn by @extended-mark/react's <XtmdDoc>
(an IR built ahead, `$state` held in React's own state, no compiler in the page) and by
@extended-mark/react-live's <XtmdLiveDoc> (the text compiled in the browser by xtmd.wasm as it is typed). Vue,
Svelte, Solid and Angular have the same pair.

Recorded with: devbench video record react-targets

The Targets page's own ids (apps/playground/targets.html, src/targets-react.ts) anchor every
selector; the drawn pages' widgets are found by their data-part names.
"""

TITLE = "React's two targets: <XtmdDoc> and <XtmdLiveDoc>"

ROW = "[data-testid='react-row']"
RUN = "[data-testid='react-run-page']"
RUN_ADD = "[data-testid='react-run-page'] [data-part='press']"
LIVE = "[data-testid='react-live-page']"
SOURCE = "[data-testid='react-live-source']"
STATUS = "[data-testid='react-live-status']"


def type_at_end(t, selector, text, delay=55):
    """Types at the end of a text, as a person who clicked after its last line would."""
    box = t.page.locator(selector).first
    box.click()
    box.press("Control+End")
    t.page.keyboard.type(text, delay=delay)


def take(t):
    t.goto("/")
    t.mark_ready()
    t.say("Every Extended Mark target comes in two kinds. Here is React's pair.", 3.4)
    t.beat("[data-testid='targets-link']", "The playground's Targets page draws one page with both.", 3.2)
    t.zoom_click("[data-testid='targets-link']")
    t.wait(2.4)

    t.page.locator(ROW).scroll_into_view_if_needed()
    t.wait(0.8)
    t.beat("[data-testid='react-run-time']", "Run time: React's <XtmdDoc> draws an IR built ahead, with React's own components. No compiler.", 4.6)
    t.hold_caption("A reader presses Add 1: the page writes $state, xtmd checks it, and React's state follows.")
    t.click(RUN_ADD, after=1.0)
    t.click(RUN_ADD, after=1.6)
    t.release_caption()
    t.beat("[data-testid='react-run-state']", "React's state holds the page's $state.", 3.0)

    t.hold_caption("Through its ref: a snapshot of everything the page holds...")
    t.click("[data-testid='react-snapshot']", after=1.2)
    t.click(RUN_ADD, after=1.4)
    t.release_caption()
    t.hold_caption("...and restore puts it back.")
    t.click("[data-testid='react-restore']", after=1.8)
    t.release_caption()
    t.beat("[data-testid='react-run-state']", "Back to the count it had.", 2.6)

    t.beat("[data-testid='react-real-time']", "Real time: React's <XtmdLiveDoc> compiles this text in the browser, with xtmd.wasm.", 4.4)
    t.hold_caption("An edit: a counter that steps by 10.")
    type_at_end(t, SOURCE, "\n@counter(by = 10);\n")
    t.wait(2.0)
    t.release_caption()
    t.beat(LIVE, "Compiled as it is typed, and drawn by React.", 3.2)

    t.hold_caption("A mistake: the step left out.")
    type_at_end(t, SOURCE, "@counter(by = );")
    t.wait(2.0)
    t.release_caption()
    t.beat(STATUS, "The draft doesn't compile: the error, with where it is.", 3.4)
    t.beat(LIVE, "And the last page that compiled stays, still working.", 3.2)

    t.say("Vue, Svelte, Solid and Angular have the same two, each held to the 62 conformance cases.", 4.2)
    t.clear_caption()
    t.wait(1.0)
