<script setup lang="ts">
import { terms } from '~/content/legal/terms';

useHead({ title: 'Điều khoản dịch vụ - flowvis' });
</script>

<template>
  <LegalDocumentView :doc="terms" testid="page-terms" />
</template>
