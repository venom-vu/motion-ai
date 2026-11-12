<script setup lang="ts">
import { useRuntimeConfig } from '#imports';
import { buildReportMailto } from '~/utils/system-status';

const reportHref = buildReportMailto(
  String(useRuntimeConfig().public.reportEmail || ''),
);
const linkClass =
  'touch-target inline-flex min-h-[48px] items-center px-2 text-xs text-cyber-muted transition hover:text-cyber-cyan';
</script>

<template>
  <footer
    data-testid="app-footer"
    class="border-t border-cyber-border bg-cyber-bg px-4 pb-20 pt-2 lg:pb-4"
  >
    <nav
      aria-label="Chân trang"
      class="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-2 sm:justify-between"
    >
      <span class="hidden text-xs text-cyber-muted sm:inline">flowvis</span>
      <div class="flex flex-wrap items-center justify-center">
        <NuxtLink to="/terms" :class="linkClass">Điều khoản dịch vụ</NuxtLink>
        <NuxtLink to="/privacy" :class="linkClass">Chính sách quyền riêng tư</NuxtLink>
        <a :href="reportHref" data-testid="footer-report-link" :class="linkClass">Báo cáo vi phạm</a>
      </div>
    </nav>
  </footer>
</template>
