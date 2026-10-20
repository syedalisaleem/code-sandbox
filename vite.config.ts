import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so the build works from a GitHub Pages project
  // subpath (https://<user>.github.io/<repo>/) as well as from a domain root.
  base: './',
  plugins: [react()],
  worker: {
    // Emit workers as native ES modules so `import` works inside them.
    format: 'es',
  },
});
