import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Secret scanner for ZeroWasteIN repository.
 * Detects key-like strings (Google API keys, bearer tokens, private keys)
 * in all workspace files (respecting .gitignore) and git history if available.
 */

const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  {
    name: 'Google API Key',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    name: 'Bearer / Auth Token',
    regex: /(?:bearer|authorization:\s*bearer)\s+([a-zA-Z0-9_\-.]{25,})/gi,
  },
  {
    name: 'Standard API Key assignment',
    regex: /(?:api[_-]?key|secret_key|access_token)\s*[:=]\s*['"]([a-zA-Z0-9_\-.]{24,})['"]/gi,
  },
  {
    name: 'Generic API Key prefix (sk-*)',
    regex: /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  },
  {
    name: 'Private Key header',
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
  },
];

const IGNORE_FILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  'pnpm-lock.yaml',
  'package-lock.json',
]);

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.next',
]);

const ALLOWED_MATCHES = new Set([
  'AIzaSyDummyKeyForTestingOnly000000000',
  'your_gemini_api_key_here',
  'your_jarvis_token_here',
]);

function isAllowed(matchText: string): boolean {
  if (ALLOWED_MATCHES.has(matchText)) return true;
  if (/example|dummy|placeholder|your_key|<key>/i.test(matchText)) return true;
  return false;
}

function getAllFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else if (entry.isFile()) {
      if (!IGNORE_FILES.has(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function scanContent(content: string, location: string): string[] {
  const violations: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(content)) !== null) {
      const matchText = match[1] || match[0];
      if (!isAllowed(matchText)) {
        const preview = matchText.length > 8 ? `${matchText.slice(0, 4)}...${matchText.slice(-4)}` : '***';
        violations.push(`${location}: matched ${pattern.name} (${preview})`);
      }
    }
  }
  return violations;
}

export function runSecretScan(): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  const rootDir = process.cwd();

  // 1. Scan filesystem files
  const files = getAllFiles(rootDir);
  for (const file of files) {
    // Skip binary files
    if (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.woff2')) {
      continue;
    }
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const fileViolations = scanContent(content, path.relative(rootDir, file));
      violations.push(...fileViolations);
    } catch {
      // Ignore unreadable files
    }
  }

  // 2. Scan git history if repository has commits
  try {
    const hasCommits = execSync('git rev-parse --verify HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    if (hasCommits) {
      const diffOutput = execSync('git log -p -n 50', { maxBuffer: 10 * 1024 * 1024 }).toString();
      const gitViolations = scanContent(diffOutput, 'git commit history');
      violations.push(...gitViolations);
    }
  } catch {
    // No git commits or git not found
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

if (process.argv[1]?.endsWith('check-secrets.ts')) {
  console.log('🔍 Scanning workspace for leaked API keys, tokens, and private keys...');
  const result = runSecretScan();
  if (result.passed) {
    console.log('✅ Secret check passed: No leaked secrets found.');
    process.exit(0);
  } else {
    console.error('❌ Secret check FAILED: Potential secrets found:');
    for (const v of result.violations) {
      console.error(`   - ${v}`);
    }
    process.exit(1);
  }
}
