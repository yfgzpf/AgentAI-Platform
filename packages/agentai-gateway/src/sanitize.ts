/**
 * 输入清洗工具 (Input Sanitization)
 * ----------------------------------------------------
 * 解决元模式 3 (输入未 sanitization):
 *   - escapeShellArg(): 转义 shell 参数
 *   - sanitizeFilename(): 清理文件名中的危险字符
 *   - validateBranchName(): 验证 git 分支名
 *   - sanitizePath(): 防止路径遍历攻击
 *
 * @see 第四层诊断: 架构预防 - 元模式 3
 */

// ===== Shell 参数转义 =====

/**
 * 安全转义 shell 参数
 * - Windows: 用双引号包裹 + 转义内部引号
 * - POSIX: 用单引号包裹 + 转义内部单引号
 */
export function escapeShellArg(arg: string): string {
  if (!arg) return "''";
  const escaped = arg.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * 安全转义 shell 路径参数
 */
export function escapeShellPath(p: string): string {
  if (!p) return "''";
  // 先用单引号包裹，内部的单引号替换为 '\''
  const escaped = p.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

// ===== 文件名清理 =====

/**
 * 清理文件名中的危险字符
 * - 移除/替换: < > : " | ? * \0 /
 * - 限制长度: 255 字符
 * - 去除前后空格和点
 */
export function sanitizeFilename(name: string): string {
  if (!name) return '';
  // 替换危险字符
  let sanitized = name
    .replace(/[<>:"|?*\\0]/g, '_')
    .replace(/\//g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  // 限制长度
  if (sanitized.length > 255) {
    sanitized = sanitized.slice(0, 255);
  }
  return sanitized || 'unnamed';
}

// ===== Git 分支名验证 =====

/**
 * 验证 git 分支名安全性
 * - 只允许: a-z, A-Z, 0-9, -, _, .
 * - 不允许: .., ~, ^, :, ?, *, [, \0, 连续 /
 * - 长度: <= 255 字符
 */
export function validateBranchName(name: string): { valid: boolean; error?: string } {
  if (!name || name.length === 0) {
    return { valid: false, error: 'Branch name cannot be empty' };
  }
  if (name.length > 255) {
    return { valid: false, error: 'Branch name too long (max 255 chars)' };
  }
  // 禁止的危险字符
  const dangerousChars = /[~^:?*\[\]\\0]/;
  if (dangerousChars.test(name)) {
    return { valid: false, error: `Branch name contains dangerous characters` };
  }
  // 禁止 ..
  if (name.includes('..')) {
    return { valid: false, error: 'Branch name cannot contain ".."' };
  }
  // 禁止连续 /
  if (name.includes('//')) {
    return { valid: false, error: 'Branch name cannot contain "//"' };
  }
  // 不能以 / 开头或结尾
  if (name.startsWith('/') || name.endsWith('/')) {
    return { valid: false, error: 'Branch name cannot start or end with "/"' };
  }
  return { valid: true };
}

/**
 * 安全地生成分支名
 */
export function safeBranchName(prefix: string, suffix: string): string {
  // 只保留合法字符
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  return `${safe(prefix)}-${safe(suffix)}`;
}

// ===== 路径遍历防护 =====

/**
 * 防止路径遍历攻击 (../)
 * - 确保 resolvedPath 在 allowedBase 下
 */
export function sanitizePath(resolvedPath: string, allowedBase: string): { valid: boolean; error?: string } {
  // 规范化路径
  const normResolved = resolvedPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  const normBase = allowedBase.replace(/\\/g, '/').replace(/\/+/g, '/');

  // 确保在允许的基础路径下
  if (!normResolved.startsWith(normBase + '/') && normResolved !== normBase) {
    return { valid: false, error: `Path traversal detected: ${resolvedPath} is outside ${allowedBase}` };
  }
  return { valid: true };
}

// ===== URL 安全检查 =====

/**
 * 检查 URL 是否为内部/危险地址
 */
export function isDangerousUrl(url: string): { dangerous: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    // 环回地址
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
        host === '::1' || host === '[::1]') {
      return { dangerous: true, reason: `Internal host: ${host}` };
    }

    // RFC 1918 私有 IP
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
      return { dangerous: true, reason: `Private IP (RFC 1918): ${host}` };
    }
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) {
      return { dangerous: true, reason: `Private IP (RFC 1918): ${host}` };
    }
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
      return { dangerous: true, reason: `Private IP (RFC 1918): ${host}` };
    }

    // 链路本地地址
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) {
      return { dangerous: true, reason: `Link-local IP: ${host}` };
    }

    // 云元数据地址 (常见 SSRF 目标)
    if (host === '169.254.169.254' || host.endsWith('.metadata.google.internal')) {
      return { dangerous: true, reason: `Cloud metadata endpoint: ${host}` };
    }

    // IPv6 环回
    if (host === '::' || host === 'fe80::' || host.startsWith('fc00:') || host.startsWith('fd00:')) {
      return { dangerous: true, reason: `IPv6 internal: ${host}` };
    }

    return { dangerous: false };
  } catch {
    return { dangerous: true, reason: 'Invalid URL' };
  }
}

// ===== 命令白名单 =====

/**
 * 危险命令黑名单
 */
const DANGEROUS_COMMANDS = [
  /(^|\||;|&)\s*(rm\s+-rf|format\s+.*\/\*|shutdown\s*-f|del\s+\/s\/q)/i,
  /(^|\||;|&)\s*(dd\s+if=|mkfs|fdisk\s+-l)/i,
  /(^|\||;|&)\s*(wget\s+.*\|\s*(sh|bash)|curl\s+.*\|\s*(sh|bash))/i,
  /(^|\||;|&)\s*(iptables\s+-F|ufw\s+reset)/i,
  /(^|\||;|&)\s*(net\s+user\s+.*\/add|netsh\s+firewall)/i,
  /(^|\||;|&)\s*(sc\s+create|reg\s+delete|schtasks)/i,
  /(^|\||;|&)\s*(passwd|chown|chmod\s+666|sudo\s+-S)/i,
];

/**
 * 检查命令是否在黑名单中
 */
export function isDangerousCommand(cmd: string): { dangerous: boolean; reason?: string } {
  for (const pattern of DANGEROUS_COMMANDS) {
    if (pattern.test(cmd)) {
      return { dangerous: true, reason: `Command matches dangerous pattern: ${pattern.source}` };
    }
  }
  return { dangerous: false };
}
