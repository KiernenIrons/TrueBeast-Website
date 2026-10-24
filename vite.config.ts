import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

/**
 * Link previews: GitHub Pages only serves real files, and crawlers (Discord,
 * X, iMessage) don't run JS, so every SPA route shows the homepage preview.
 * This writes dist/<route>/index.html copies of the built page with that
 * route's own og: tags. The copy still boots the full app.
 */
const OG_PAGES: { route: string; title: string; description: string; image: string }[] = [
  {
    route: 'meet',
    title: 'Meet — Find a time that works | TrueBeast',
    description: "Share one link. Everyone drags over when they're free, and the best time shows up instantly. Free, no sign-up.",
    image: 'https://truebeast.io/assets/images/og-meet.png',
  },
]

function ogPages() {
  return {
    name: 'og-pages',
    apply: 'build' as const,
    closeBundle() {
      const out = path.resolve(__dirname, 'dist')
      const base = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      for (const p of OG_PAGES) {
        const url = `https://truebeast.io/${p.route}/`
        const html = base
          .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(p.title)}">`)
          .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(p.description)}">\n    <meta name="description" content="${esc(p.description)}">`)
          .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}">`)
          .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${p.image}">\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">\n    <meta name="twitter:image" content="${p.image}">\n    <meta name="theme-color" content="#22c55e">`)
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`)
        fs.mkdirSync(path.join(out, p.route), { recursive: true })
        fs.writeFileSync(path.join(out, p.route, 'index.html'), html)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ogPages(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
