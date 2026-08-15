/// <reference types="astro/client" />

// O pacote @fontsource não publica declarações de tipo para os imports de
// efeito colateral (`import '@fontsource/...'`, que só injeta CSS). Sem esta
// declaração, o astro check acusa 6 erros ts(2882) — ruído que esconde erros
// reais. Não afeta nada em execução: a fonte sempre carregou normalmente.
declare module '@fontsource/*';
