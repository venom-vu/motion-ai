export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  srcDir: '.',
  devtools: { enabled: false },
  modules: ['@nuxtjs/tailwindcss', '@nuxt/icon'],
  css: ['~/assets/css/main.css'],
  nitro: {
    preset: 'cloudflare-pages',
    output: {
      dir: '.output/public',
      publicDir: '.output/public',
      serverDir: '.output/public/_worker.js',
    },
  },
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:8080',
    },
  },
  icon: {
    provider: 'server',
    serverBundle: {
      collections: ['lucide'],
    },
    clientBundle: {
      scan: true,
    },
    attrs: {
      'stroke-width': '2',
      class: 'lucide-icon',
    },
  },
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts',
    exposeConfig: false,
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'vi',
        class: 'dark',
      },
      title: 'flowvis — Tạo Ảnh & Video AI',
      meta: [
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=5',
        },
        {
          name: 'description',
          content:
            'Nền tảng tạo ảnh và video AI chuyên nghiệp: Hoán đổi khuôn mặt, Nâng ngực AI tự nhiên và Điều khiển chuyển động.',
        },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossorigin: '',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap',
        },
      ],
    },
  },
});
