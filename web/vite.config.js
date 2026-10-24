import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve ../models directly so we can reuse the existing URDF and meshes.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(currentDir, '../models'),
  server: { fs: { allow: [path.resolve(currentDir, '..')] } },
});
