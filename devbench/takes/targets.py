"""Extended Mark's two kinds of target: one page drawn by the plain web's run-time target (an IR built ahead,
no compiler in the page) and by its real-time target (the text compiled in the browser by xtmd.wasm),
after the playground, which now compiles in the browser too.

Recorded with: devbench video record targets

The playground's and the Targets page's own ids (apps/playground/index.html, targets.html) anchor
every selector; the drawn pages' widgets are found by their data-part names.
"""

TITLE = "Extended Mark's two kinds of target: run time and real time"

EDITOR = "[data-testid='editor']"
PREVIEW = "[data-testid='preview']"
RUN = "[data-testid='run-page']"
RUN_ADD = "[data-testid='run-page'] [data-part='press']"
LIVE = "[data-testid='live-page']"
SOURCE = "[data-testid='live-source']"
STATUS = "[data-testid='live-status']"


def type_at_end(t, selector, text, delay=55):
    """Types at the end of a text, as a person who clicked after its last line would."""
    box = t.page.locator(selector).first
    box.click()
    box.press("Control+End")
    t.page.keyboard.type(text, delay=delay)


def take(t):
    t.goto("/?example=counter")
    t.mark_ready()
    t.say("The playground now compiles in the browser: xtmd.wasm, in a worker, and no server compiles anything.", 4.4)

    t.highlight(EDITOR, hold=0.6)
    t.hold_caption("An edit: a second counter, stepping by 5.")
    type_at_end(t, EDITOR, "\n\n@counter(by = 5);\n")
    t.wait(2.0)
    t.release_caption()
    t.beat(PREVIEW, "Compiled in the tab, and drawn as soon as it does.", 3.2)

    t.beat("[data-testid='targets-link']", "Every target now comes in two kinds. The Targets page shows both.", 3.6)
    t.zoom_click("[data-testid='targets-link']")
    t.wait(2.4)

    t.beat("[data-testid='run-time']", "Run time: XtmdDoc draws an IR built ahead. The page carries no compiler.", 4.2)
    t.hold_caption("A reader presses Add 1, twice.")
    t.click(RUN_ADD, after=0.8)
    t.click(RUN_ADD, after=1.2)
    t.release_caption()
    t.beat("[data-testid='run-state']", "$state follows: the app hears every change, checked by xtmd.", 3.4)

    t.hold_caption("A snapshot takes $state and every widget's own variables...")
    t.click("[data-testid='snapshot']", after=1.2)
    t.click(RUN_ADD, after=1.4)
    t.release_caption()
    t.hold_caption("...and restore puts them back.")
    t.click("[data-testid='restore']", after=1.8)
    t.release_caption()
    t.beat("[data-testid='run-state']", "Back to the count it had.", 2.8)

    t.beat("[data-testid='real-time']", "Real time: XtmdLiveDoc compiles this text in the browser as it changes.", 4.2)
    t.hold_caption("An edit to the text: a counter that steps by 10.")
    type_at_end(t, SOURCE, "\n@counter(by = 10);\n")
    t.wait(2.0)
    t.release_caption()
    t.beat(LIVE, "Compiled as it is typed, and drawn at once.", 3.2)

    t.hold_caption("A mistake: the step left out.")
    type_at_end(t, SOURCE, "@counter(by = );")
    t.wait(2.0)
    t.release_caption()
    t.beat(STATUS, "A draft that doesn't compile: the error, with where it is.", 3.6)
    t.beat(LIVE, "And the last page that compiled stays, still working.", 3.4)

    t.hold_caption("Taking the mistake out draws it again.")
    box = t.page.locator(SOURCE).first
    box.click()
    box.press("Control+End")
    for _ in range(len("@counter(by = );")):
        t.page.keyboard.press("Backspace")
        t.wait(0.03)
    t.wait(2.0)
    t.release_caption()
    t.beat(STATUS, "Compiled in the browser.", 2.6)

    t.say("React, Vue, Svelte, Solid, Angular, egui and Compose have the same two kinds, each held to the 62 conformance cases.", 5.0)
    t.clear_caption()
    t.wait(1.2)
