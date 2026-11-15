"""Editing an MKP page in the playground: the page drawn live, its Markdown, its $state and its
diagnostics, all following each edit.

Recorded with: devbench video record playground

The playground's own ids (apps/playground/index.html) anchor every selector; the drawn page's
widgets are found by @mkp/dom's data-part names.
"""

TITLE = "Editing an MKP page in the playground"

EDITOR = "[data-testid='editor']"
PREVIEW = "[data-testid='preview']"
FIRST_ADD = "[data-testid='preview'] [data-part='press']"


def type_at_end(t, text, delay=60):
    """Types at the end of the source, as a person who clicked after the last line would."""
    editor = t.page.locator(EDITOR).first
    editor.click()
    editor.press("Control+End")
    t.page.keyboard.type(text, delay=delay)


def take(t):
    t.goto("/?example=counter")
    t.mark_ready()
    t.say("MKP's playground: a page's source, and the page it draws.", 3.2)

    t.beat(EDITOR, "On the left, the source: Markdown, with $state and a widget written in MKP.", 3.6)
    t.beat(PREVIEW, "On the right, the page itself, drawn live by @mkp/dom.", 3.2)

    t.hold_caption("Pressing a button runs its handler, and the page is drawn again.")
    t.click(FIRST_ADD, after=0.8)
    t.click(FIRST_ADD, after=1.4)
    t.release_caption()
    t.beat("[data-testid='markdown-output']", "Its Markdown follows, with the count it has now.", 3.4)

    t.click("[data-testid='tab-state']", after=0.8)
    t.beat("[data-testid='state-body']", "And $state holds the same count.", 3.0)

    t.highlight(EDITOR, hold=0.6)
    t.hold_caption("Now an edit: a second counter that steps by 5.")
    type_at_end(t, "\n\n@counter(by = 5);\n")
    t.wait(2.4)
    t.release_caption()
    t.beat(PREVIEW, "It is drawn as soon as the source compiles, sharing the same $state.", 3.6)

    t.hold_caption("A mistake: a word where the counter takes a number.")
    type_at_end(t, '@counter(by = "five");')
    t.wait(2.4)
    t.release_caption()
    t.click("[data-testid='tab-diagnostics']", after=0.8)
    t.beat("[data-testid='diagnostic']", "The compiler says what is wrong, and on which line.", 3.6)
    t.maybe_beat("[data-testid='stale-banner']", "The last good page stays on screen, marked as out of date.", 3.2)

    t.hold_caption("Taking the mistake out draws the page again.")
    editor = t.page.locator(EDITOR).first
    editor.click()
    editor.press("Control+End")
    for _ in range(len('@counter(by = "five");')):
        t.page.keyboard.press("Backspace")
        t.wait(0.03)
    t.wait(2.4)
    t.release_caption()
    t.beat("[data-testid='status']", "Compiled, with no errors.", 2.6)

    t.set_value("[data-testid='example-picker']", "release-flow", zoom=None, hold=3.0)
    t.beat(PREVIEW, "Another page: a graph from the graphs pack, laid out on core's plane.", 4.0)
    t.click("[data-testid='tab-markdown']", after=0.6)
    t.beat("[data-testid='markdown-output']", "And as Markdown: its label, its nodes, then its links.", 3.6)

    t.clear_caption()
    t.wait(1.4)
