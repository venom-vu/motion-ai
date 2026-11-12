<script setup lang="ts">
import { useRuntimeConfig } from '#imports';
import { privacy } from '~/content/legal/privacy';

useHead({ title: 'Chính sách quyền riêng tư - flowvis' });
const contactEmail = String(useRuntimeConfig().public.reportEmail || '');
</script>

<template>
  <div>
    <LegalDocumentView :doc="privacy" testid="page-privacy" />
    <p
      v-if="contactEmail"
      class="mx-auto max-w-3xl pb-4 text-sm text-cyber-muted"
      data-testid="privacy-contact-email"
    >
      Email liên hệ:
      <a :href="`mailto:${contactEmail}`" class="text-cyber-cyan underline">{{ contactEmail }}</a>
    </p>
  </div>
</template>
