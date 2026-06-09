import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://coachruiz.com.br',
  i18n: {
    defaultLocale: 'pt-br',
    locales: ['pt-br', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
