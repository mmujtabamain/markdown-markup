import { createSignal, Show } from 'solid-js';
import { MkpView } from './MkpView';
import { compile, type SignalEvent } from './vendor/mkp/mkp.js';
import source from './lesson.mkp.md?raw';

const bundle = compile({ packs: [] }).document(source, 'lesson.mkp.md')!;

export function App() {
  const [dark, setDark] = createSignal(false);
  const [shown, setShown] = createSignal(true);
  const [said, setSaid] = createSignal('');
  const onSignal = (e: SignalEvent) => {
    const p = e.payload as { value: string; correct: boolean };
    setSaid(`${e.name}: ${p.value} (${p.correct ? 'right' : 'wrong'})`);
  };
  return (
    <>
      <header>
        <h2>MKP in Solid</h2>
        <button onClick={() => setDark(!dark())}>{dark() ? 'Light' : 'Dark'}</button>
        <button onClick={() => setShown(!shown())}>{shown() ? 'Hide' : 'Show'}</button>
        <output data-said>{said()}</output>
      </header>
      <Show when={shown()}>
        <MkpView bundle={bundle} theme={dark() ? 'dark' : 'light'} onSignal={onSignal} />
      </Show>
    </>
  );
}
