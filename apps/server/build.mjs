import { cpSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

const version =
  process.env.APP_VERSION || JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

// Bundle the server and @cbt/core into one file. Native modules, and PDFKit (which reads its
// own data files at runtime), stay external and are installed next to the bundle in the image.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['better-sqlite3', '@node-rs/argon2', 'pdfkit'],
  define: { __APP_VERSION__: JSON.stringify(version) },
  banner: {
    js: "import { createRequire as __cbtCreateRequire } from 'node:module'; const require = __cbtCreateRequire(import.meta.url);",
  },
});

// Fonts embedded in PDFs, found next to the bundle at runtime.
cpSync('assets/fonts', 'dist/fonts', { recursive: true });
