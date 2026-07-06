import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 開発中はブラウザのCORS制限を避けるため、/moodle-api への
// リクエストをVite開発サーバー経由で大学のMoodleへ中継する。
// 本番ではSupabase Edge Functionがこの役割を担う予定。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/moodle-api': {
        target: 'https://kadai-moodle.kagawa-u.ac.jp',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/moodle-api/, ''),
      },
    },
  },
})
