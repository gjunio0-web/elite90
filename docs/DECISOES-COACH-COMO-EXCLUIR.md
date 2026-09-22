# Como excluir — consulta de Fase 5 ao Coach Fernando

> Artefato temporário, criado para uma consulta pontual (rubrica de 25
> critérios + desfecho favorável por fase, Fase 5 do M2). Não faz parte do
> produto — remover assim que as duas respostas forem obtidas e registradas
> nos documentos de governança.

## O que remover, em três passos

**1. Apagar o dado.**

```bash
node scripts/apagar-decisoes-coach.mjs
```

Roda contra o mesmo projeto Firebase que `FIREBASE_SERVICE_ACCOUNT_JSON`
apontar no ambiente — confirme qual antes de rodar, se tiver mais de um
configurado localmente. Não tem confirmação interativa; apaga direto.

**2. Apagar os três arquivos de código.**

```bash
rm netlify/functions/salvar-decisoes-coach.ts
rm netlify/functions/ler-decisoes-coach.ts
rm apps/site/src/pages/decisoes-coach.astro
rm scripts/apagar-decisoes-coach.mjs
rm docs/DECISOES-COACH-COMO-EXCLUIR.md
```

**3. Remover a entrada do filtro de sitemap.**

Em `apps/site/astro.config.mjs`, o filtro que hoje lê:

```js
&& !/\/(definir-senha|acesso-equipe|decisoes-coach)\/?$/.test(page),
```

volta a:

```js
&& !/\/(definir-senha|acesso-equipe)\/?$/.test(page),
```

## O que NÃO precisa mexer

Nenhuma outra coleção, função ou rota do projeto referencia
`coachDecisions` ou `decisoes-coach` em lugar nenhum — a exclusão dos
itens acima é completa e isolada, sem risco de deixar referência solta ou
de afetar qualquer outra parte do sistema.

## Quando fazer isso

Assim que o Coach Fernando tiver respondido as duas decisões, e a resposta
tiver sido registrada no Adendo 07 (governança) — depois disso, esta página
não tem mais propósito.
