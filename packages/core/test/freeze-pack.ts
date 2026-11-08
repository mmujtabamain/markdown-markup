// a release-notes pack: a scene whose frames are swapped by a press, and a still with a picture
import type { PackSource } from '../src/build';

export const enc = new TextEncoder();
export const frame = (word: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200"><script>alert(1)</script><rect width="480" height="200" fill="#eee"/><text x="10" y="20">${word}</text></svg>`;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
export const pack: PackSource = {
  label: 'notes',
  files: new Map<string, Uint8Array>([
    ['manifest.mkp', enc.encode('pack notes@1 "Release notes."\n  requires core@1\n  provides scene still\n')],
    [
      'scene.mkp',
      enc.encode(
        [
          'scene@1 "A frozen scene: press Filter to open it."',
          '  var open bool = false',
          '  canvas x=0..480 y=0..200 aspect=2.4',
          '    layer',
          '      image (if(open, "frames/open.svg", "frames/closed.svg")) ((240, 100)) 480 200 alt="The Tasks pane"',
          '      path ([(380, 176), (468, 176), (468, 146), (380, 146)]) closed=true fill=surface opacity=0.01 label="Filter"',
          '        @click set open=(not open)',
          '  project md = "The Tasks pane."',
          '',
          'still@1 "A still."',
          '  column',
          '    image "frames/still.svg" alt="A still"',
          '    image "shot.png" alt="A shot"',
          '    image "elsewhere.svg" alt="Not in the pack"',
          '',
        ].join('\n'),
      ),
    ],
    ['scene.fixture.json', enc.encode(JSON.stringify({ widget: 'scene@1', cases: { one: { props: {}, summary: 'One.' } } }))],
    ['still.fixture.json', enc.encode(JSON.stringify({ widget: 'still@1', cases: { one: { props: {}, summary: 'One.' } } }))],
    ['frames/closed.svg', enc.encode(frame('closed'))],
    ['frames/open.svg', enc.encode(frame('open'))],
    ['frames/still.svg', enc.encode(frame('still'))],
    ['frames/unused.svg', enc.encode(frame('unused'))],
    ['shot.png', png],
  ]),
};
