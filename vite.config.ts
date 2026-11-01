import { defineConfig, loadEnv, type Plugin } from 'vite';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
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

/**
 * Dev only: /api/detect forwards one JSON request to the OpenCV detector (research/vcf/detect.py --serve).
 * GET answers 200 so the page knows it can offer perceived-state mode. The deployed site has no Python, so the
 * route does not exist there and the toggle stays hidden.
 */
function devDetect(): Plugin {
  let proc: ChildProcessWithoutNullStreams | null = null;
  const waiting: ((line: string) => void)[] = [];
  const py = ['research/.venv/Scripts/python.exe', 'research/.venv/bin/python'].find((p) => existsSync(p)) ?? 'python';
  const start = () => {
    proc = spawn(py, ['-u', 'research/vcf/detect.py', '--serve'], { stdio: 'pipe' });
    createInterface({ input: proc.stdout }).on('line', (l) => waiting.shift()?.(l));
    proc.on('exit', () => (proc = null));
    return proc;
  };
  return {
    name: 'dev-detect',
    configureServer(server) {
      server.middlewares.use('/api/detect', (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') return res.end('{"available":true}');
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          waiting.push((line) => res.end(line));
          (proc ?? start()).stdin.write(body.replace(/\n/g, '') + '\n');
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [devApi(loadEnv(mode, process.cwd(), '')), devDetect()],
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: resolve('index.html'), bench: resolve('bench.html') } },
  },
}));
