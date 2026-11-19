"""Each framework's two kinds of target: React, Vue, Svelte, Solid and Angular, each drawing one Extended Mark
page with its run-time <XtmdDoc> (an IR built ahead, no compiler) and its real-time <XtmdLiveDoc>
(the text compiled in the browser by xtmd.wasm), every page drawn by the framework itself.

Recorded against the showcase built from the bindings themselves (they aren't part of the
preview's image):

    node targets/ts/bindings/testing/showcase/build.mjs
    PORT=8790 node targets/ts/bindings/testing/showcase/serve.mjs
    devbench video record framework-targets --base http://127.0.0.1:8790

Selectors are the showcase's own ids (testing/showcase/shell.js); widgets are found by their
data-part names.
"""

TITLE = "Five frameworks, two kinds of Extended Mark target each"

FRAMEWORKS = [
    ("react", "React"),
    ("vue", "Vue"),
    ("svelte", "Svelte"),
    ("solid", "Solid"),
    ("angular", "Angular"),
]


def type_at_end(t, selector, text, delay=45):
    """Types at the end of a text, as a person who clicked after its last line would."""
    box = t.page.locator(selector).first
    box.click()
    box.press("Control+End")
    t.page.keyboard.type(text, delay=delay)


def take(t):
    t.goto("/")
    t.wait(3.0)
    t.mark_ready()
    t.say("One Extended Mark page, in five frameworks: each with its run-time and its real-time target.", 3.8)

    for fw, name in FRAMEWORKS:
        run = f"[data-testid='{fw}-run']"
        t.page.locator(f"[data-testid='{fw}']").scroll_into_view_if_needed()
        t.wait(0.5)
        t.beat(run, f"{name}, run time: <XtmdDoc> draws the IR built ahead, with {name}'s own rendering.", 3.4)
        t.click(f"{run} [data-part='press']", after=1.0)
        t.beat(f"[data-testid='{fw}-run-state']", "A press: $state changes, checked by xtmd.", 2.4)
        t.hold_caption(f"{name}, real time: <XtmdLiveDoc> compiles the text in the browser as it changes.")
        type_at_end(t, f"[data-testid='{fw}-source']", "\n@counter(by = 10);\n")
        t.wait(1.6)
        t.release_caption()
        t.beat(f"[data-testid='{fw}-live']", "The edit, compiled and drawn: a counter that steps by 10.", 2.8)

    t.hold_caption("And a draft that doesn't compile...")
    type_at_end(t, "[data-testid='angular-source']", "@counter(by = );")
    t.wait(1.8)
    t.release_caption()
    t.beat("[data-testid='angular-status']", "...says where the error is, and the last page that compiled stays.", 3.6)

    t.say("Ten targets, each held to the 62 conformance cases.", 3.2)
    t.clear_caption()
    t.wait(1.0)
