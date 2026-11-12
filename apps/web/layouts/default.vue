<script setup lang="ts">
import { usePricingConfig } from '~/composables/usePricingConfig';

const { me } = usePricingConfig();
</script>

<template>
  <div
    data-testid="layout-default"
    class="flex min-h-dvh w-full max-w-[100vw] flex-col overflow-x-hidden bg-cyber-bg pt-[68px] text-cyber-text"
  >
    <AppTopHeader
      :balance="me?.balance ?? null"
      :held="me?.held ?? null"
      :tier="me?.tier ?? 'FREE'"
      :email="me?.email ?? null"
      :role="me?.role ?? null"
    />

    <main
      class="mx-auto w-full max-w-7xl flex-1 px-4 pb-6 pt-5 sm:px-6 lg:px-8 lg:pb-8"
    >
      <slot />
    </main>

    <AppFooter />

    <AppBottomNav />
    <AuthDialog />
  </div>
</template>
