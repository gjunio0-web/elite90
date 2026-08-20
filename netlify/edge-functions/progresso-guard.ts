export default async function (req: Request, context: any) {
  if (context.deploy.context === "production") {
    // Os dois documentos de demonstracao (plano de treino e nutricional) sao
    // publicos de proposito: o time precisa abri-los em producao para conferir
    // o FORMATO em que o atleta recebera o documento. O resto de /progresso
    // continua fechado ao publico.
    //
    // POR QUE `(\/|$)` E NAO `\/`
    // Edge function roda ANTES da resolucao de pretty URL do Netlify, entao o
    // caminho chega exatamente como foi digitado -- /progresso/demo-treino, sem
    // a barra final, e uma forma legitima e comum. Exigir a barra fazia esse
    // endereco cair na 404, que foi o defeito relatado em 20/08/2026.
    const url = new URL(req.url);
    if (/^\/progresso\/(demo-treino|demo-nutricional)(\/|$)/.test(url.pathname)) {
      return context.next();
    }
    // Reescreve para a 404 estilizada em vez de devolver texto puro: a URL na
    // barra de endereco continua sendo /progresso/..., so o conteudo muda. O
    // rewrite em si serve /404.html com status 200 (e um arquivo real, existente);
    // o status e forcado para 404 aqui por fora, que e o que de fato importa.
    const res = await context.rewrite(new URL("/404.html", req.url));
    return new Response(res.body, { status: 404, headers: res.headers });
  }
}

export const config = { path: "/progresso*" };
