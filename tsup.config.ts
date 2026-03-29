import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  outDir: 'dist',
  target: 'node20',
  shims: false,
});
