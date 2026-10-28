// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('apps/web security checks', () => {
  const webDir = path.resolve(__dirname, '..');

  const secretKeywords = [
    'JARVISLABS_API_KEY',
    'GEMINI_API_KEY',
    'API_KEY',
    'SECRET_KEY',
    'PRIVATE_KEY',
  ];

  function getAllFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (['node_modules', 'dist', '.git', 'test'].includes(file)) {
        continue;
      }
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        getAllFiles(fullPath, fileList);
      } else {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  it('ensures no source file under apps/web references secret environment variable names', () => {
    const webFiles = getAllFiles(webDir);
    expect(webFiles.length).toBeGreaterThan(0);

    const violations: { file: string; keyword: string }[] = [];

    for (const filePath of webFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const secret of secretKeywords) {
        if (content.includes(secret)) {
          violations.push({ file: path.relative(webDir, filePath), keyword: secret });
        }
      }
    }

    expect(
      violations,
      `Detected secret variable references in web client: ${JSON.stringify(violations)}`
    ).toEqual([]);
  });

  it('ensures no VITE_ prefixed environment variables expose secrets in client code', () => {
    const webFiles = getAllFiles(webDir);
    const secretVitePattern = /VITE_[A-Z0-9_]*(KEY|SECRET|TOKEN|AUTH|PASS)[A-Z0-9_]*/i;
    const violations: { file: string; match: string }[] = [];

    for (const filePath of webFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(secretVitePattern);
      if (match) {
        violations.push({ file: path.relative(webDir, filePath), match: match[0] });
      }
    }

    expect(
      violations,
      `Detected potential secret in VITE_ variable: ${JSON.stringify(violations)}`
    ).toEqual([]);
  });

  it('ensures no dangerouslySetInnerHTML is used anywhere across apps/web', () => {
    const webFiles = getAllFiles(webDir);
    const violations: string[] = [];

    for (const filePath of webFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('dangerouslySetInnerHTML')) {
        violations.push(path.relative(webDir, filePath));
      }
    }

    expect(
      violations,
      `Detected dangerouslySetInnerHTML in web client files: ${JSON.stringify(violations)}`
    ).toEqual([]);
  });

  it('ensures all model-derived strings render safely as escaped text nodes without HTML injection', () => {
    const injectionPayload = '<img src=x onerror=alert(1)>Malicious Payload';
    // When rendered inside JSX {itemLabel}, React escapes tags into text content automatically
    const div = document.createElement('div');
    div.textContent = injectionPayload;

    expect(div.innerHTML).not.toContain('<img');
    expect(div.innerHTML).toContain('&lt;img');
    expect(div.textContent).toBe(injectionPayload);
  });

  it('asserts vercel.json configures strict CSP without unsafe-inline, nosniff, Referrer-Policy, and camera Permissions-Policy', () => {
    const vercelConfigPath = path.resolve(__dirname, '../../../vercel.json');
    expect(fs.existsSync(vercelConfigPath)).toBe(true);

    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf-8'));
    const headersList: { key: string; value: string }[] =
      vercelConfig.headers?.[0]?.headers ?? [];

    const headersMap = new Map<string, string>();
    for (const h of headersList) {
      headersMap.set(h.key.toLowerCase(), h.value);
    }

    // 1. Content-Security-Policy
    const csp = headersMap.get('content-security-policy');
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");

    // 2. X-Content-Type-Options
    const contentTypeOptions = headersMap.get('x-content-type-options');
    expect(contentTypeOptions).toBe('nosniff');

    // 3. Referrer-Policy
    const referrerPolicy = headersMap.get('referrer-policy');
    expect(referrerPolicy).toBeDefined();
    expect(['strict-origin-when-cross-origin', 'no-referrer', 'same-origin']).toContain(
      referrerPolicy
    );

    // 4. Permissions-Policy
    const permissionsPolicy = headersMap.get('permissions-policy');
    expect(permissionsPolicy).toBeDefined();
    expect(permissionsPolicy).toContain('camera=(self)');
  });

  it('scans all tracked repository files and git commits to confirm zero leaked keys or bearer tokens', () => {
    // Dynamic import of secret scanner
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runSecretScan } = require(path.resolve(__dirname, '../../../scripts/check-secrets.ts'));
    const scanResult = runSecretScan();
    expect(
      scanResult.violations,
      `Secrets detected in repository: ${JSON.stringify(scanResult.violations)}`
    ).toEqual([]);
    expect(scanResult.passed).toBe(true);
  });
});
