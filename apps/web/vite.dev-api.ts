import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only Vite plugin that mounts the serverless classification handler at /api/classify.
 *
 * @returns Vite Plugin configured for local development serving.
 */
export default function devApiPlugin(): Plugin {
  return {
    name: 'dev-api-classifier',
    apply: 'serve',
    configureServer(server) {
      // Load root environment file into server-side process environment without exposing to client
      const rootCandidates = [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '../../.env'),
        path.resolve(__dirname, '../../.env'),
      ];

      for (const envPath of rootCandidates) {
        if (fs.existsSync(envPath)) {
          const rawLines = fs.readFileSync(envPath, 'utf-8').split('\n');
          for (const rawLine of rawLines) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) {
              continue;
            }
            const separatorIndex = line.indexOf('=');
            if (separatorIndex !== -1) {
              const variableName = line.slice(0, separatorIndex).trim();
              const variableValue = line.slice(separatorIndex + 1).trim();
              if (variableName && process.env[variableName] === undefined) {
                process.env[variableName] = variableValue;
              }
            }
          }
          break;
        }
      }

      // Intercept local development calls to the classification endpoint
      server.middlewares.use('/api/classify', (req, res) => {
        let bodyBuffer = '';
        req.on('data', (chunk) => {
          bodyBuffer += chunk;
        });

        req.on('end', async () => {
          let parsedJson: unknown;
          try {
            parsedJson = bodyBuffer ? JSON.parse(bodyBuffer) : undefined;
          } catch {
            parsedJson = undefined;
          }

          // Construct serverless response mock adapter
          interface MockVercelResponse {
            status: (code: number) => MockVercelResponse;
            json: (jsonPayload: unknown) => MockVercelResponse;
            send: (payload: unknown) => MockVercelResponse;
          }

          const vercelRes = res as unknown as MockVercelResponse;
          vercelRes.status = (code: number) => {
            res.statusCode = code;
            return vercelRes;
          };
          vercelRes.json = (jsonPayload: unknown) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(jsonPayload));
            return vercelRes;
          };
          vercelRes.send = (payload: unknown) => {
            res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
            return vercelRes;
          };

          interface MockVercelRequest {
            body?: unknown;
          }

          const vercelReq = req as unknown as MockVercelRequest;
          vercelReq.body = parsedJson;

          try {
            const modulePath = path.resolve(__dirname, '../../api/classify.ts');
            const classifyModule = await server.ssrLoadModule(modulePath);
            await classifyModule.default(vercelReq, vercelRes);
          } catch (err: unknown) {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: {
                    code: 'PROVIDERS_UNAVAILABLE',
                    message: err instanceof Error ? err.message : 'Dev server API error',
                    requestId: 'dev-exception',
                  },
                })
              );
            }
          }
        });
      });
    },
  };
}
