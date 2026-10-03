// tests/_carregar-ts.js
// Test helper (not a test file: the runner only picks up *.test.js). Loads a
// TypeScript Netlify function into the Node test runner by bundling it with
// esbuild, the bundler the repository already installs through the site's
// toolchain. Firebase modules are replaced by stubs that read from
// `globalThis.__e90Stubs` at call time, so each test can swap them.
//
// Everything else — `_scoring.ts`, `_llm.ts`, `_llm-nucleo.js` — is bundled
// for real: the characterization tests exercise the code that ships.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  throw new Error(
    'esbuild not found. It is installed with the workspace dependencies (npm ci at the repository root).',
  );
}

const RAIZ = path.resolve(__dirname, '..');

/**
 * Module specifiers replaced by stubs, with the names each one exports. Every
 * name is a getter that reads `globalThis.__e90Stubs[module][name]` when the
 * code under test touches it, so a test can swap a stub after loading.
 */
const STUBS = {
  'firebase-admin/auth': ['getAuth'],
  'firebase-admin/storage': ['getStorage'],
  'firebase-admin/firestore': ['FieldValue', 'Timestamp', 'FieldPath', 'getFirestore'],
  './_firebase': ['getApp', 'getDb', 'storageBucketName'],
  './_rastreabilidade': ['registrar'],
};

const pluginStubs = {
  name: 'e90-stubs',
  setup(build) {
    const escapar = (s) => s.replace(/[./-]/g, '\\$&');
    const filtro = new RegExp(`^(${Object.keys(STUBS).map(escapar).join('|')})$`);
    build.onResolve({ filter: filtro }, (args) => ({ path: args.path, namespace: 'e90-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'e90-stub' }, (args) => ({
      contents:
        `const modulo = ${JSON.stringify(args.path)};\n` +
        `for (const nome of ${JSON.stringify(STUBS[args.path])}) {\n` +
        '  Object.defineProperty(exports, nome, { enumerable: true, get() {\n' +
        '    const s = (globalThis.__e90Stubs || {})[modulo];\n' +
        '    if (!s || !(nome in s)) throw new Error(`stub ${modulo}.${nome} not provided by the test`);\n' +
        '    return s[nome];\n' +
        '  } });\n' +
        '}\n',
      loader: 'js',
    }));
  },
};

/**
 * Bundles `relativo` (path from the repository root) and returns its exports.
 * Asynchronous because esbuild runs plugins only in its async API. A fresh
 * bundle per call: module-level state never leaks between tests.
 */
async function carregarTs(relativo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e90-ts-'));
  const saida = path.join(dir, path.basename(relativo).replace(/\.ts$/, '.cjs'));
  await esbuild.build({
    entryPoints: [path.join(RAIZ, relativo)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: saida,
    logLevel: 'silent',
    plugins: [pluginStubs],
  });
  return require(saida);
}

module.exports = { carregarTs, RAIZ };
