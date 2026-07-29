import { defineConfig } from 'vite';

// Twitch hosts extension assets under a versioned CDN path, so every asset
// reference must be relative -- `base: './'` keeps Vite from emitting
// absolute `/assets/...` URLs that would 404 once uploaded to Twitch.
//
// `assetsDir: ''` flattens the build so JS/CSS land at the zip's root
// alongside index.html, no `assets/` subfolder -- confirmed via a live
// Hosted Test request that Twitch's asset CDN serves the root-level
// index.html fine but 404s ("Asset Not Found") on anything nested one
// folder deeper, even with an otherwise-correct URL.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: '',
  },
});
