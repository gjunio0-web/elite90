// tests/imagem.test.js
// Image format detection by magic bytes (netlify/functions/_imagem.ts).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarTs } = require('./_carregar-ts.js');

const bytes = (...v) => Uint8Array.from([...v, ...new Array(16).fill(0)]);

test('reconhece WebP, JPEG e PNG pelos bytes iniciais', async () => {
  const { detectarImagem } = await carregarTs('netlify/functions/_imagem.ts');
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0]);
  assert.deepEqual(detectarImagem(webp), { mime: 'image/webp', ext: 'webp' });
  assert.deepEqual(detectarImagem(bytes(0xff, 0xd8, 0xff, 0xe0)), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(detectarImagem(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), { mime: 'image/png', ext: 'png' });
});

test('RIFF que não é WebP (ex.: WAV/AVI) não é reconhecido', async () => {
  const { detectarImagem } = await carregarTs('netlify/functions/_imagem.ts');
  const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45, 0, 0]);
  assert.equal(detectarImagem(wav), null);
});

test('HEIC, GIF, texto, vazio, curto demais e nulo → null', async () => {
  const { detectarImagem } = await carregarTs('netlify/functions/_imagem.ts');
  assert.equal(detectarImagem(Buffer.from('GIF89a......')), null);
  assert.equal(detectarImagem(Buffer.from('<html>não é imagem</html>')), null);
  assert.equal(detectarImagem(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), null); // ftypheic
  assert.equal(detectarImagem(new Uint8Array(0)), null);
  assert.equal(detectarImagem(Uint8Array.from([0xff, 0xd8, 0xff])), null, 'curto demais');
  assert.equal(detectarImagem(null), null);
  assert.equal(detectarImagem(undefined), null);
});

test('funciona com Buffer do Node (o que o servidor recebe)', async () => {
  const { detectarImagem } = await carregarTs('netlify/functions/_imagem.ts');
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(20)]);
  assert.equal(detectarImagem(jpg).mime, 'image/jpeg');
});
