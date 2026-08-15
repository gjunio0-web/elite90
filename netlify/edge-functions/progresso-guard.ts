export default async function (req: Request, context: any) {
  if (context.deploy.context === "production") {
    // Reescreve para a 404 estilizada em vez de devolver texto puro: a URL na
    // barra de endereco continua sendo /progresso/..., so o conteudo muda. O
    // rewrite em si serve /404.html com status 200 (e um arquivo real, existente);
    // o status e forcado para 404 aqui por fora, que e o que de fato importa.
    const res = await context.rewrite(new URL("/404.html", req.url));
    return new Response(res.body, { status: 404, headers: res.headers });
  }
}

export const config = { path: "/progresso*" };
