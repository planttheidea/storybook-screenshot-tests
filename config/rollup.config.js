import { createRollupConfig } from '@planttheidea/build-tools';

export default createRollupConfig({
  cjs: false,
  config: 'config',
  source: 'src',
  sourceMap: false,
  umd: false,
});
