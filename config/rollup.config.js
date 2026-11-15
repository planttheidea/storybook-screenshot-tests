import { createRollupConfig } from '@planttheidea/build-tools';
import typescript from '@rollup/plugin-typescript';
import tsc from 'typescript';

export default [
  ...createRollupConfig({
    cjs: false,
    config: 'config',
    source: 'src',
    sourceMap: false,
    umd: false,
  }),
  // The `storybook-screenshot-tests` command, bundled apart from the library so
  // starting a file server never loads Playwright or dependency-cruiser.
  {
    external: [/^node:/],
    input: 'src/bin.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/es/bin.mjs',
      format: 'es',
    },
    plugins: [
      typescript({
        compilerOptions: { declaration: false, declarationDir: undefined },
        tsconfig: 'config/types/es.json',
        typescript: tsc,
      }),
    ],
  },
];
