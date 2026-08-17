import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', client: 'src/client.tsx' },
  format: ['esm'],
  // P0 修复 #4：浏览器端 bundle 必须是 __ModuleLoader__.load 单文件（官方协议）。
  // client 入口关闭代码分割（不产出相对 chunk 导入），并把平台 seed 词保持外部，
  // 由 scripts/wrap-loader.cjs 在构建后改写为 dsh 浏览器加载格式。
  splitting: false,
  dts: true,
  outDir: 'lib',
  clean: true,
  sourcemap: true,
  external: ['react', 'react-dom', 'react/jsx-runtime']
});
