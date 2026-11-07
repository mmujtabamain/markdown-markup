<!-- MkpView: an MKP document in a Vue app. Copy this file; it needs the release's web files in ./vendor/mkp. -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { mount, type IRBundle, type MountedDocument, type SignalEvent } from './vendor/mkp/mkp-dom.js';

const props = defineProps<{ bundle: IRBundle; theme?: 'light' | 'dark' | 'auto' }>();
const emit = defineEmits<{ signal: [e: SignalEvent] }>();
const el = ref<HTMLElement>();
let view: MountedDocument | undefined;

onMounted(() => {
  view = mount(el.value!, props.bundle, { theme: props.theme, onSignal: (e) => emit('signal', e) });
});
// a new theme keeps the reader's place; a new bundle starts the document again
watch(() => props.theme, (theme) => view?.update({ theme }));
watch(() => props.bundle, (bundle) => view?.setBundle(bundle));
onBeforeUnmount(() => view?.unmount());
</script>

<template><div ref="el" /></template>
