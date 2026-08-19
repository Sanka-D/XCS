import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    clean: true,
    dts: true,
    format: ['esm'],
    sourcemap: true,
    target: 'es2023',
  },
  {
    entry: ['src/bin.ts'],
    banner: { js: '#!/usr/bin/env node' },
    dts: false,
    format: ['esm'],
    sourcemap: true,
    target: 'node24',
  },
])
