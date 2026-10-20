import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    // Emit workers as native ES modules so `import` works inside them.
    format: 'es',
  },
});
