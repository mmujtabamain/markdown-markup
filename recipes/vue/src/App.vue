<script setup lang="ts">
import { ref } from 'vue';
import MkpView from './MkpView.vue';
import { compile, type SignalEvent } from './vendor/mkp/mkp.js';
import source from './lesson.mkp.md?raw';

const bundle = compile({ packs: [] }).document(source, 'lesson.mkp.md')!;
const dark = ref(false);
const shown = ref(true);
const said = ref('');
const onSignal = (e: SignalEvent) => {
  const p = e.payload as { value: string; correct: boolean };
  said.value = `${e.name}: ${p.value} (${p.correct ? 'right' : 'wrong'})`;
};
</script>

<template>
  <header>
    <h2>MKP in Vue</h2>
    <button @click="dark = !dark">{{ dark ? 'Light' : 'Dark' }}</button>
    <button @click="shown = !shown">{{ shown ? 'Hide' : 'Show' }}</button>
    <output data-said>{{ said }}</output>
  </header>
  <MkpView v-if="shown" :bundle="bundle" :theme="dark ? 'dark' : 'light'" @signal="onSignal" />
</template>
