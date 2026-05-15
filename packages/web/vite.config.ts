import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../..');

function loadLocalEnv() {
  const envPath = path.join(repoRoot, '.env.local');
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key || process.env[key] != null) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function localApiPlugin() {
  return {
    name: 'local-api-functions',
    configureServer(server) {
      loadLocalEnv();
      const handlers = new Map<string, any>();

      server.middlewares.use('/api/ai', async (req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://local.dev').pathname;
        const endpoint = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
        if (!['status', 'openrouter', 'deepseek', 'claude'].includes(endpoint)) {
          next();
          return;
        }

        try {
          const file = path.join(repoRoot, 'api/ai', `${endpoint}.js`);
          const handler = handlers.get(endpoint) || require(file);
          handlers.set(endpoint, handler);
          await handler(req, res);
        } catch (err) {
          server.config.logger.error(err instanceof Error ? err.stack || err.message : String(err));
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
          }
          res.end(JSON.stringify({ error: 'Local API handler failed' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5184,
    host: true,
  },
});
