<script setup lang="ts">
import type { LegalDocument } from '~/content/legal/terms';

defineProps<{ doc: LegalDocument; testid: string }>();
</script>

<template>
  <article
    class="mx-auto max-w-3xl space-y-6 py-4 text-sm leading-relaxed text-cyber-muted"
    :data-testid="testid"
  >
    <header class="space-y-2">
      <h1 class="text-xl font-bold text-cyber-text">{{ doc.title }}</h1>
      <p class="font-mono text-xs">Phiên bản {{ doc.version }}</p>
      <LegalDraftBanner v-if="doc.status === 'draft'" />
    </header>
    <section v-for="s in doc.sections" :key="s.heading" class="space-y-2">
      <h2 class="font-semibold text-cyber-text">{{ s.heading }}</h2>
      <p v-for="(p, i) in s.paragraphs" :key="i">{{ p }}</p>
    </section>
  </article>
</template>
