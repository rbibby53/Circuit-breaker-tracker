import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const version =
  process.env.APP_VERSION || JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

// Bundle the server and @cbt/core into one file. Native modules stay external and are
// installed next to the bundle in the Docker image.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['better-sqlite3', '@node-rs/argon2'],
  define: { __APP_VERSION__: JSON.stringify(version) },
  banner: {
    js: "import { createRequire as __cbtCreateRequire } from 'node:module'; const require = __cbtCreateRequire(import.meta.url);",
  },
});
