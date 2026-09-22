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
      // Rotas de acesso restrito ficam fora do sitemap. `profissional` é
      // tratado como SEGMENTO de caminho, igual a admin/avaliacao/progresso —
      // não como rota-folha — porque a área do profissional cresceu: existem
      // hoje /profissional/ e /profissional/guia/, e um filtro que só batesse
      // a raiz exata deixaria as sub-rotas vazando. Foi achado em execução,
      // testando o build desta mesma entrega — o filtro anterior (v1.24/AC-35)
      // só cobria a raiz. (O propor-item de catálogo, AC-34, virou modal
      // sobre o próprio editor — não é mais rota própria, mas o filtro por
      // segmento continua correto e necessário para o guia.)
      // /definir-senha e /acesso-equipe continuam como rota-folha: não têm
      // sub-rotas, e não deveriam ganhar uma sem decisão nova.
      filter: page => !/\/(admin|avaliacao|progresso|profissional)\//.test(page)
                   && !/\/(definir-senha|acesso-equipe|decisoes-coach)\/?$/.test(page),
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
