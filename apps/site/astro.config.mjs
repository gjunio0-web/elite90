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
      // Rotas de acesso restrito ficam fora do sitemap. Além de /admin/,
      // /avaliacao/ e /progresso/, entram três rotas de nível raiz: a área do
      // profissional, a página de definição de senha, e /acesso-equipe
      // (AC-35, CA-98 — esta última NÃO pode ser descoberta pelo sitemap, já
      // que substitui a obscuridade que o portão de /admin/login dava).
      // As duas primeiras já tinham `noindex` na própria página, mas constavam
      // do sitemap assim mesmo — publicar o endereço e pedir para não indexar
      // é contraditório.
      filter: page => !/\/(admin|avaliacao|progresso)\//.test(page)
                   && !/\/(profissional|definir-senha|acesso-equipe)\/?$/.test(page),
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
