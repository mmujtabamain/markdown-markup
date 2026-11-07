// MKP in a page with no framework and no build step. Serve this folder with the release's web files
// in ./vendor/mkp, from any static server (modules do not load from file://).
import { compile } from './vendor/mkp/mkp.js';
import { mount } from './vendor/mkp/mkp-dom.js';

const source = await (await fetch('./lesson.mkp.md')).text();
const bundle = compile({ packs: [] }).document(source, 'lesson.mkp.md');
const el = document.getElementById('doc');
const said = document.querySelector('[data-said]');
let dark = false;

const options = () => ({
  theme: dark ? 'dark' : 'light',
  onSignal: (e) => (said.textContent = `${e.name}: ${e.payload.value} (${e.payload.correct ? 'right' : 'wrong'})`),
});
let view = mount(el, bundle, options());

// a new theme keeps the reader's place
document.getElementById('theme').onclick = (e) => {
  dark = !dark;
  e.target.textContent = dark ? 'Light' : 'Dark';
  view?.update({ theme: dark ? 'dark' : 'light' });
};
// unmount() removes the document; mounting again starts it afresh
document.getElementById('shown').onclick = (e) => {
  if (view) (view.unmount(), (view = null));
  else view = mount(el, bundle, options());
  e.target.textContent = view ? 'Hide' : 'Show';
};
