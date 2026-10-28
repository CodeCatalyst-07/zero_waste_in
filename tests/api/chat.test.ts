import { describe, expect, it, vi, beforeEach } from 'vitest';
import chatHandler, { type VercelRequest, type VercelResponse } from '../../api/chat.js';

function createMockReqRes(options: {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): { req: VercelRequest; res: VercelResponse; output: { status: number; json: any } } {
  const output = { status: 200, json: null as any };
  const req = {
    method: options.method ?? 'POST',
    body: options.body ?? {},
    headers: options.headers ?? { 'content-type': 'application/json' },
  } as unknown as VercelRequest;

  const res = {
    status(code: number) {
      output.status = code;
      return res;
    },
    json(data: any) {
      output.json = data;
      return res;
    },
    send(data: any) {
      output.json = data;
      return res;
    },
  } as unknown as VercelResponse;

  return { req, res, output };
}

describe('api/chat serverless endpoint', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-POST requests with 400 BAD_INPUT', async () => {
    const { req, res, output } = createMockReqRes({ method: 'GET' });
    await chatHandler(req, res);
    expect(output.status).toBe(400);
    expect(output.json.error.code).toBe('BAD_INPUT');
  });

  it('rejects empty or missing message field with 400 BAD_INPUT', async () => {
    const { req, res, output } = createMockReqRes({
      method: 'POST',
      body: { message: '' },
    });
    await chatHandler(req, res);
    expect(output.status).toBe(400);
    expect(output.json.error.code).toBe('BAD_INPUT');
  });

  it('handles stringified JSON body cleanly', async () => {
    const { req, res, output } = createMockReqRes({
      method: 'POST',
      body: JSON.stringify({ message: 'Where do batteries go?' }),
    });
    await chatHandler(req, res);
    expect(output.status).toBe(200);
    expect(output.json.reply).toBeDefined();
    expect(output.json.reply.toLowerCase()).toContain('special care');
  });

  it('returns statutory fallback answers for common items when providers unavailable', async () => {
    const { req, res, output } = createMockReqRes({
      method: 'POST',
      body: { message: 'Can I compost food peels?' },
    });
    await chatHandler(req, res);
    expect(output.status).toBe(200);
    expect(output.json.reply).toBeDefined();
    expect(output.json.reply.toLowerCase()).toContain('wet');
  });

  it('returns carbon baseline info when asked about electricity', async () => {
    const { req, res, output } = createMockReqRes({
      method: 'POST',
      body: { message: 'What is the CEA grid factor for electricity?' },
    });
    await chatHandler(req, res);
    expect(output.status).toBe(200);
    expect(output.json.reply).toBeDefined();
    expect(output.json.reply).toContain('0.675');
  });
});
