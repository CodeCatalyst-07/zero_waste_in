import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { resetSystemContext, type VercelRequest, type VercelResponse } from '../classify.js';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
  setHeader: (name: string, value: string) => MockResponse;
  send: (data: unknown) => MockResponse;
  end: () => MockResponse;
}

function createMockReqRes(options: {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): { req: VercelRequest; res: VercelResponse; mockRes: MockResponse } {
  const mockRes: MockResponse = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(data: unknown) {
      this.body = data;
      return this;
    },
    end() {
      return this;
    },
  };

  const req = {
    method: options.method ?? 'POST',
    headers: options.headers ?? {
      'content-type': 'application/json',
      'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: options.body,
  } as unknown as VercelRequest;

  return { req, res: mockRes as unknown as VercelResponse, mockRes };
}

describe('Security & Fuzzing: /api/classify', () => {
  beforeEach(() => {
    resetSystemContext();
  });

  describe('Fuzzing input validation', () => {
    it('rejects massive text payloads exceeding maxTextLength with 400 BAD_INPUT', async () => {
      const hugeText = 'a'.repeat(50000); // 50 KB text
      const { req, res, mockRes } = createMockReqRes({ body: { mode: 'text', text: hugeText } });

      await handler(req, res);

      expect(mockRes.statusCode).toBe(400);
      expect((mockRes.body as any).error.code).toBe('BAD_INPUT');
      expect((mockRes.body as any).error.message).toContain('maximum allowed length');
    });

    it.each([
      { name: 'null byte', text: 'plastic\u0000bottle' },
      { name: 'bell char', text: 'plastic\u0007bottle' },
      { name: 'escape sequence', text: 'battery\u001b[31m' },
      { name: 'backspace', text: 'paper\u0008cup' },
    ])('rejects text containing control characters ($name) with 400 BAD_INPUT', async ({ text }) => {
      const { req, res, mockRes } = createMockReqRes({ body: { mode: 'text', text } });

      await handler(req, res);

      expect(mockRes.statusCode).toBe(400);
      expect((mockRes.body as any).error.code).toBe('BAD_INPUT');
      expect((mockRes.body as any).error.message).toContain('control characters');
    });

    it.each([
      { label: 'missing mode', payload: { text: 'cardboard' }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'invalid mode string', payload: { mode: 'audio', text: 'cardboard' }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'number as mode', payload: { mode: 123, text: 'cardboard' }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'number as text', payload: { mode: 'text', text: 12345 }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'boolean as text', payload: { mode: 'text', text: true }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'object as text', payload: { mode: 'text', text: { query: 'peel' } }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'array as text', payload: { mode: 'text', text: ['apple', 'banana'] }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'number as image', payload: { mode: 'image', image: 99999, mimeType: 'image/jpeg' }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'object as image', payload: { mode: 'image', image: { data: 'xyz' }, mimeType: 'image/jpeg' }, expectedStatus: 400, expectedCode: 'BAD_INPUT' },
      { label: 'number as mimeType', payload: { mode: 'image', image: 'validbase64', mimeType: 12345 }, expectedStatus: 415, expectedCode: 'UNSUPPORTED_MEDIA' },
    ])('rejects wrong types ($label) with $expectedStatus $expectedCode', async ({ payload, expectedStatus, expectedCode }) => {
      const { req, res, mockRes } = createMockReqRes({ body: payload });

      await handler(req, res);

      expect(mockRes.statusCode).toBe(expectedStatus);
      expect((mockRes.body as any).error.code).toBe(expectedCode);
    });

    it('rejects image with mismatched magic bytes (PNG header declared as JPEG) with 415', async () => {
      // Valid PNG magic bytes
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      const { req, res, mockRes } = createMockReqRes({
        body: { mode: 'image', image: pngBytes.toString('base64'), mimeType: 'image/jpeg' },
      });

      await handler(req, res);

      expect(mockRes.statusCode).toBe(415);
      expect((mockRes.body as any).error.code).toBe('UNSUPPORTED_MEDIA');
    });

    it('rejects image with mismatched magic bytes (JPEG header declared as PNG) with 415', async () => {
      // Valid JPEG magic bytes
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      const { req, res, mockRes } = createMockReqRes({
        body: { mode: 'image', image: jpegBytes.toString('base64'), mimeType: 'image/png' },
      });

      await handler(req, res);

      expect(mockRes.statusCode).toBe(415);
      expect((mockRes.body as any).error.code).toBe('UNSUPPORTED_MEDIA');
    });

    it('rejects image with invalid random binary header with 415', async () => {
      const garbageBytes = Buffer.from('NOT_A_VALID_IMAGE_HEADER_AT_ALL');
      const { req, res, mockRes } = createMockReqRes({
        body: { mode: 'image', image: garbageBytes.toString('base64'), mimeType: 'image/webp' },
      });

      await handler(req, res);

      expect(mockRes.statusCode).toBe(415);
      expect((mockRes.body as any).error.code).toBe('UNSUPPORTED_MEDIA');
    });

    it('rejects image exceeding maxUploadBytes (1 MB) with 413 TOO_LARGE', async () => {
      // 1 MB + 100 bytes of dummy image
      const oversizeBuffer = Buffer.alloc(1024 * 1024 + 100);
      oversizeBuffer[0] = 0xff;
      oversizeBuffer[1] = 0xd8;
      oversizeBuffer[2] = 0xff;

      const { req, res, mockRes } = createMockReqRes({
        body: { mode: 'image', image: oversizeBuffer.toString('base64'), mimeType: 'image/jpeg' },
      });

      await handler(req, res);

      expect(mockRes.statusCode).toBe(413);
      expect((mockRes.body as any).error.code).toBe('TOO_LARGE');
    });

    it('gracefully handles excess/unexpected fields without crash or prototype pollution', async () => {
      const { req, res, mockRes } = createMockReqRes({
        body: {
          mode: 'text',
          text: 'banana peel',
          extraPollution: '__proto__',
          sqlInjection: '1; DROP TABLE items;',
          deepNested: { a: { b: 123 } },
        },
      });

      await handler(req, res);

      // Fast path text lookup still succeeds safely
      expect(mockRes.statusCode).toBe(200);
      expect((mockRes.body as any).verdict.kind).toBe('answer');
      expect((mockRes.body as any).verdict.stream).toBe('wet');
    });
  });

  describe('Error body sanitization', () => {
    it('ensures error responses never leak stack traces, internal paths, or provider details', async () => {
      const testCases = [
        { body: { mode: 'text', text: '' }, expectedStatus: 400 },
        { body: { mode: 'text', text: 'a'.repeat(2000) }, expectedStatus: 400 },
        { body: { mode: 'image', image: 'invalid', mimeType: 'image/jpeg' }, expectedStatus: 415 },
        { body: { mode: 'image', image: 'invalid', mimeType: 'image/bmp' }, expectedStatus: 415 },
      ];

      for (const tc of testCases) {
        const { req, res, mockRes } = createMockReqRes({ body: tc.body });
        await handler(req, res);

        expect(mockRes.statusCode).toBe(tc.expectedStatus);
        const body = mockRes.body as any;

        // Strict schema: only { error: { code, message, requestId } }
        expect(Object.keys(body)).toEqual(['error']);
        expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId'].sort());

        // Check for leakages
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain('stack');
        expect(serialized).not.toContain('at ');
        expect(serialized).not.toContain('node:');
        expect(serialized).not.toContain('/Users/');
        expect(serialized).not.toContain('/home/');
        expect(serialized).not.toContain('jarvis');
        expect(serialized).not.toContain('gemini');
      }
    });

    it('catches unexpected internal exceptions and returns 500 PROVIDERS_UNAVAILABLE safely', async () => {
      const { setSystemContext } = await import('../classify.js');
      const { loadConfig } = await import('../config.js');

      setSystemContext({
        config: loadConfig(),
        router: {
          route: () => Promise.reject(new Error('Fatal database crash')),
        } as any,
      });

      // 1x1 valid PNG base64
      const validPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const { req, res, mockRes } = createMockReqRes({
        body: { mode: 'image', image: validPngBase64, mimeType: 'image/png' },
      });

      await handler(req, res);

      expect(mockRes.statusCode).toBe(500);
      expect((mockRes.body as any).error.code).toBe('PROVIDERS_UNAVAILABLE');
      expect((mockRes.body as any).error.message).toContain('unexpected error');
      expect(JSON.stringify(mockRes.body)).not.toContain('Fatal database crash');
    });
  });

  describe('Observability log sanitization', () => {
    it('ensures console log output strictly contains only requestId, mode, providerUsed, latencyMs, outcomeCode', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { req, res } = createMockReqRes({ body: { mode: 'text', text: 'cardboard box' } });
      await handler(req, res);

      expect(logSpy).toHaveBeenCalled();
      const lastCallArg = logSpy.mock.calls[logSpy.mock.calls.length - 1]?.[0];
      expect(typeof lastCallArg).toBe('string');

      const parsedLog = JSON.parse(lastCallArg);
      const expectedKeys = ['requestId', 'mode', 'providerUsed', 'latencyMs', 'outcomeCode'].sort();
      expect(Object.keys(parsedLog).sort()).toEqual(expectedKeys);

      // Verify log contains zero query text, image data, or secrets
      const rawLog = JSON.stringify(parsedLog);
      expect(rawLog).not.toContain('cardboard box');
      expect(rawLog).not.toContain('key');
      expect(rawLog).not.toContain('base64');

      logSpy.mockRestore();
    });
  });
});
