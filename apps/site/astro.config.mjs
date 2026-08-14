import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'server',
  adapter: netlify(),
  site: 'https://coachruiz.com.br',
  i18n: {
    defaultLocale: 'pt-br',
    locales: ['pt-br', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [
    sitemap({
      filter: page => !/\/(admin|avaliacao|progresso)\//.test(page),
      // Declara a relacao entre as duas versoes de idioma no proprio sitemap.
      // A chave 'pt-br' nunca aparece na rota (prefixDefaultLocale: false), e a
      // integracao trata como idioma padrao tudo o que nao contiver outro locale.
      i18n: {
        defaultLocale: 'pt-br',
        locales: { 'pt-br': 'pt-BR', en: 'en' },
      },
    }),
  ],
});
