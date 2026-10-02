import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devServerPlugin } from './mock/plugin.ts';

export default defineConfig({
  plugins: [react(), devServerPlugin()],
});
