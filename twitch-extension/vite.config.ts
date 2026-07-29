import { defineConfig } from 'vite';

// Twitch hosts extension assets under a versioned CDN path, so every asset
// reference must be relative -- `base: './'` keeps Vite from emitting
// absolute `/assets/...` URLs that would 404 once uploaded to Twitch.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
