import { createEslintConfig } from '@planttheidea/build-tools';
import typescriptEslint from 'typescript-eslint';

export default createEslintConfig({
  config: 'config',
  configs: [
    {
      // Flat config resolves a rule's plugin within the config object that
      // declares it, and `configs` is spread in at the top level — outside the
      // object where `strictTypeChecked` registers `@typescript-eslint`. Naming
      // the plugin here is what puts the rule's namespace back in scope.
      files: ['**/*.ts'],
      plugins: { '@typescript-eslint': typescriptEslint.plugin },
      rules: {
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      },
    },
    {
      // `import/no-unresolved` is switched off for TypeScript, where the
      // compiler already checks resolution, but stays on for config JavaScript.
      // Its resolver predates export maps, so an ESM-only package like this one
      // reads as missing even though Node resolves it.
      files: ['config/**/*.js'],
      rules: {
        'import/no-unresolved': ['error', { ignore: ['^typescript-eslint$'] }],
      },
    },
    {
      files: ['src/globalSetup.ts'],
      rules: {
        'import/no-default-export': 'off',
      },
    },
  ],
  development: 'dev',
  react: false,
  source: 'src',
});
