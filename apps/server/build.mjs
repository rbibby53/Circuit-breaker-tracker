import { build } from 'esbuild';

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
  banner: {
    js: "import { createRequire as __cbtCreateRequire } from 'node:module'; const require = __cbtCreateRequire(import.meta.url);",
  },
});
