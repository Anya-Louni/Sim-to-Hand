import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { handleLLM } from './server/handler.ts';

/** Serves /api/llm during development with keys from .env, same handler as the deployed function. */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/llm', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            /* handled below */
          }
          const out = await handleLLM(parsed, { RATE_PER_10MIN: '100000', RATE_PER_DAY: '100000', ...env }, req.socket.remoteAddress ?? 'local');
          res.statusCode = out.status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(out.json));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [devApi(loadEnv(mode, process.cwd(), ''))],
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: resolve('index.html'), bench: resolve('bench.html') } },
  },
}));
