// ELITE90 PRO · _imagem
// -----------------------------------------------------------------------------
// Identifica o formato de uma imagem pelos primeiros bytes, e não pelo nome ou
// pelo tipo declarado.
//
// POR QUE EXISTE (06/10/2026)
// O formulário comprime as fotos no navegador pedindo WebP. Os navegadores que
// não sabem gerar WebP no canvas (os da Apple, pelo que se sabe) entregam PNG, e
// o formulário agora cai para JPEG nesse caso. O servidor, porém, gravava toda
// foto como `foto-N.webp` com `contentType: image/webp`, e `generate-evaluation`
// enviava toda foto ao modelo como `image/webp`: um JPEG assim rotulado é gravado
// com o tipo errado e pode ser lido errado pelo modelo. Aqui a verdade vem do
// conteúdo.
// -----------------------------------------------------------------------------

export type FormatoImagem = { mime: "image/webp" | "image/jpeg" | "image/png"; ext: "webp" | "jpg" | "png" };

/** Formato reconhecido pelos bytes iniciais, ou null (HEIC, GIF, texto, vazio…). */
export function detectarImagem(buffer: Uint8Array | null | undefined): FormatoImagem | null {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  // WebP: "RIFF" ???? "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: "image/png", ext: "png" };
  return null;
}
