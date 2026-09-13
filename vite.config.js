import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// GAME_MODE=3d でフェーズ2（Three.js）ビルド。既定はフェーズ1（Canvas2D・単一 index.html）
const mode3d = process.env.GAME_MODE === '3d';

// フェーズ2：assets/（glb・音声）を出力先にそのままコピーする。無ければ何もしない（プレースホルダーで動く）
function copyAssets() {
  let outDir = 'dist';
  return {
    name: 'copy-assets',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      const src = resolve('assets');
      if (!existsSync(src)) return;
      cpSync(src, resolve(outDir, 'assets'), { recursive: true });
    }
  };
}

export default defineConfig({
  define: {
    __GAME_MODE__: JSON.stringify(mode3d ? '3d' : '2d')
  },
  plugins: mode3d ? [copyAssets()] : [viteSingleFile()],
  build: {
    target: 'es2020',
    assetsInlineLimit: mode3d ? 4096 : 100000000,
    cssCodeSplit: false
  },
  server: { port: 5173, open: false }
});
