import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Moodleとの通信はSupabase Edge Function(moodle-sync)が担うため、
// 開発サーバーにプロキシは不要になった。
// base はGitHub Pagesの公開パス(https://<user>.github.io/sakiyomi/)に合わせる。
export default defineConfig({
  base: '/sakiyomi/',
  plugins: [react(), tailwindcss()],
})
