"""MKP 0.3: pointing inside widgets, arrows that meet what they join, and the layout fixes.

Recorded with: devbench video record mkp-0-3

Opens the playground with a small document (in the link's src=) that shows, in MKP's own look:
a pie whose slices take @enter/@leave/@click, a tree whose arrows touch their boxes with a straight
run before each head, and a badge placed by self=start in a stack. (The playground draws with the
shadcn provider, so the neutral look's new switch thumb is not in it.)
"""

TITLE = "MKP 0.3: pointing inside widgets, arrows that meet what they join"

DEMO = "/examples/#e=ex:04-hello&src=nVbBbuM2EP2VgXuolHUUJ9491K0W3R72UhRYtAX2EAUILVEWI4oUSCq2N_C_95GSbDkO0HaDWKbImcfhzJtHv8z4jjWt5PZm8f664lLqm0LnSVO3SVPMVrMf6GvF3I-WFN-SUPTH719okSwzlanHx0eYZcq2XBWUzb5ooRwx_JOVIuekS3IVp1bwn6k13FrSipPTmMlrEi7JZpkijyocbyxJYV1keK5NMSC8SLbmckWO79ycnpns-IpU1xxi7_jMDBDJ75rS9e045dF5cTbttGMSb7Zrooa1UdhvTpbSj2STgBsHyFLRmpfa8KheeYQ4bDfxLIV03ESGqQ2PFnOSXPVoMV3TbTwn4TEF_UL18cUv34uHV_sAIXIB_rhJK-iG7gB054duMNzyYjOJJ2Sp9bmO4XLvg1jED_SOfHjHuJYLbP_kt49ybSO_WTSeLIZxH1Q9BEVXsL3xTniGZMVwt0J9j-PxhFU3CTvXUhsELMqopjQlxJjfzo-vGOZ3-Cx7b6W3vS3q-zEY9_tq9ZAETsxBOKVdJdQmmwWXvNKWq95roMDUs5868wYZ99wN7gY7blibSmJSbFSac4VC-xVAM_XMLLiULD4kiX-eja34xlPQ1yOn2Sz0Q4ir9yas7Eco_8dZXlHteb9IkugVg6jm-7Q-GRO1zFUjCWLKJY5ZpM4g-SCjTKM-S8hhjbMqPELeUQayzugaoXWmZOimrShcld4NgR4LGV6nGxL9Gg5Pljs02Hk0WJScPfNxsW-wyWoufXf71T7lozsI0DUq5NiOLr6vR-VAxiAeK7q6yjJw6wUUOGA8e20bQE9mfdmPlq3RTzx31BRgwhNwL_o9m13jAybb_uSxJ0MGQfM8gKYN0haqmKnguaL7UYn-RGaOSvTTYnGYH0Xqs9bFcWl5tvS3QcbkcfH2w-LwAOHsmoaZ_Yr-GhhDIBnzekl73XnWUTtoajINLaiuM5wj8E8GxLXQWehuw5H0rR9Bdvfh9HMUHexhngpMbCpHphsljvgzN3uqOCsGJZ6UaCDExojCT9v0_rY0cxofD8GoGWszOLasQB8MrJMC_WVYITqb5gySLoq0JdsylS5BD1metdikwi0zWDgV_r-CswskycvvwFlf4DSiKCT__0j5BZLxNRiBmK8dlUY3SIzTKYMIdY6nhd6qty3W_2qRTywQp1HcpF7pLnoD1KE-06TBA1DGEyqvhCwwGQhxYpwn24Svn8hPXHJyLZwNwGsGteovdjtEMfckBBkhfQMlDced7KquWc99Kne4EQs_2A9sHK73tdb-6i6ZtOEUlolivBt862p0bvguy1dSvntLy61jkKdeCkvh3igp3CBGLm2Qx2Ja0otq-l7NXWfepMYO3PCnSXe2F2okZURr8d73AMIx7gJ4CYHqb5WGwdKhgCcV555D6VrLIaD-p1UtFNjYJxjIqDOkF-kbb6Wv4vqzuFDTMEu9kvrEHk4WEyGHzEe4bPEdv8Gj31DkV3zxRJjqW38Kf1nbkTWzwz8"

# a point inside a canvas shape, in page coordinates: the middle of its box need not be inside it
INSIDE = """sel => {
  const el = document.querySelectorAll(sel.q)[sel.i];
  const p = el.tagName === 'g' ? el.querySelector('path') : el;
  const b = p.getBBox();
  const m = p.getScreenCTM();
  for (let k = 1; k < 40; k++) for (const fx of [0.5, 0.35, 0.65, 0.25, 0.75]) {
    const pt = new DOMPoint(b.x + b.width * fx, b.y + (b.height * k) / 40);
    if (p.isPointInFill(pt)) { const s = pt.matrixTransform(m); return [s.x, s.y]; }
  }
  const r = el.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
}"""


def hover_shape(t, i, hold=1.6):
    x, y = t.page.evaluate(INSIDE, {"q": ".mkp-root [data-pointed]", "i": i})
    t.page.evaluate("p => window.__recMove && window.__recMove(p[0],p[1])", [x, y])
    t.page.mouse.move(x, y, steps=12)
    t.wait(hold)
    return x, y


def take(t):
    t.goto(DEMO, settle=4.0)
    t.page.wait_for_selector(".mkp-root [data-pointed]", timeout=30000)
    t.mark_ready()
    t.say("MKP 0.3, in the playground: a document that shows what changed.", 3.2)

    t.beat(".mkp-root .mkp-canvas", "Shapes inside a widget can now be pointed at: each slice has @enter, @leave and @click.", 3.6)
    hover_shape(t, 0)
    t.hold_caption("Moving onto a slice raises enter; the widget lights it and names it.")
    hover_shape(t, 1, 1.8)
    hover_shape(t, 2, 1.8)
    x, y = hover_shape(t, 1, 0.8)
    t.page.evaluate("p => window.__recRipple && window.__recRipple(p[0],p[1])", [x, y])
    t.page.mouse.click(x, y)
    t.wait(2.0)
    t.release_caption()
    t.page.mouse.move(5, 5)
    t.say("No pointer position reaches the document. A slice that can be pressed needs a label, so screen readers can name it.", 4.2)

    t.beat(".mkp-root [data-mkp-id=p]", "Arrows now touch the boxes they join, with a straight run before every head, even in an 8 px gap.", 4.2)
    t.zoom_to(".mkp-root [data-mkp-id=b]", hold=2.6)
    t.zoom_out()
    t.say("The right-hand line uses corner=none, for square turns.", 3.0)

    t.beat(".mkp-root [data-mkp=stack]", "self=start in a stack now places the badge in its corner. Before, it stretched across the picture.", 3.8)
    t.clear_caption()
    t.wait(1.2)
