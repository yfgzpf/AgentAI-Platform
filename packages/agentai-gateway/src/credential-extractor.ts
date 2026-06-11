/** 从消息中提取凭据 (API key, token, password 等) */
export function extractCredentials(text: string): Array<{ type: string; value: string; start: number; end: number }> {
  const results: Array<{ type: string; value: string; start: number; end: number }> = [];
  const patterns: Array<{ type: string; regex: RegExp }> = [
    { type: 'api_key', regex: /sk-[A-Za-z0-9]{20,}/g },
    { type: 'api_key', regex: /api[_-]?key['"]?\s*[:=]\s*['"]([A-Za-z0-9_\-]{16,})['"]/gi },
    { type: 'token', regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
    { type: 'password', regex: /password['"]?\s*[:=]\s*['"]([^'"]{6,})['"]/gi },
    { type: 'secret', regex: /secret['"]?\s*[:=]\s*['"]([^'"]{8,})['"]/gi },
  ];
  for (const { type, regex } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      results.push({ type, value: match[0].slice(0, 20) + '...', start: match.index, end: match.index + match[0].length });
    }
  }
  return results;
}

export function maskCredentials(text: string): string {
  let masked = text;
  const patterns = [
    /sk-[A-Za-z0-9]{20,}/g,
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    /(api[_-]?key|password|secret)['"]?\s*[:=]\s*['"][A-Za-z0-9_\-]{6,}['"]/gi,
  ];
  for (const re of patterns) {
    masked = masked.replace(re, (m) => {
      if (m.length < 8) return m;
      return m.slice(0, 4) + '****' + m.slice(-4);
    });
  }
  return masked;
}
