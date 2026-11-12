<script setup lang="ts">
import { definePageMeta } from '#imports';

// Trang tổng quan chưa hoàn thiện: /admin chuyển thẳng tới trang Thống kê.
definePageMeta({
  layout: 'admin',
  redirect: '/admin/stats',
});
</script>

<template>
  <div data-testid="page-admin" />
</template>
