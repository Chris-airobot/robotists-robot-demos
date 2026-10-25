import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

// Serve ../models directly so we can reuse the existing URDF and meshes.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const reportFile = path.join(currentDir, 'benchmark-results', 'latest.json');

// Only active in the local Vite development server. No external telemetry.
function benchmarkCollector() {
  return {
    name: 'robotists-local-benchmark-collector',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__robotists/benchmark', (req, res) => {
        if (req.method === 'GET') {
          fs.readFile(reportFile, 'utf-8')
            .then(json => {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(json);
            })
            .catch(() => {
              res.statusCode = 404;
              res.end('No benchmark report yet');
            });
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        // Only accept same-origin JSON. Keep the collector local and opt-in.
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (origin && (!host || new URL(origin).host !== host)) {
          res.statusCode = 403;
          res.end('Cross-origin report rejected');
          return;
        }
        let json = '';
        req.on('data', chunk => {
          json += chunk;
          if (json.length > 64000) req.destroy();
        });
        req.on('end', async () => {
          try {
            const report = JSON.parse(json);
            if (report.schemaVersion !== 1 || !Array.isArray(report.results) ||
                report.results.length !== 3 ||
                report.results.some(item => typeof item.fps !== 'number')) {
              throw new Error('Invalid benchmark report');
            }
            await fs.mkdir(path.dirname(reportFile), { recursive: true });
            await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf-8');
            const summary = report.results.map(item =>
              item.id + ': ' + item.fps + ' FPS (p95 ' + item.frameMs?.p95 + 'ms)'
            ).join(' | ');
            console.log('\n[Robotists FPS Test] ' + summary);
            console.log('[Robotists FPS Test] GPU: ' + (report.environment?.renderer || 'unknown'));
            console.log('[Robotists FPS Test] Details: ' + reportFile + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ saved: true, path: 'benchmark-results/latest.json' }));
          } catch (error) {
            res.statusCode = 400;
            res.end('Invalid benchmark: ' + error.message);
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), benchmarkCollector()],
  publicDir: path.resolve(currentDir, '../models'),
  server: { fs: { allow: [path.resolve(currentDir, '..')] } },
});
