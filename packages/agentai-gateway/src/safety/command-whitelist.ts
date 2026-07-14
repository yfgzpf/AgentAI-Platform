/**
 * command-whitelist: 命令注入防护
 * ----------------------------------------------------
 * 用途: 校验 execSync 等命令执行入口的输入
 * 防护: 白名单 + 链式操作符 + 命令替换
 */
const ALLOWED_COMMANDS = new Set([
  'node', 'npm', 'pnpm', 'yarn',
  'python', 'python3', 'pip', 'pip3',
  'git', 'tsc',
]);

// 危险的代码执行选项（防止 RCE）
const DANGEROUS_FLAGS = new Set([
  '-e', '--eval', '-c', '--command', '-r', '--require',
  '-p', '--print', '--inspect', '--inspect-brk',
  'eval', 'exec',
]);

export function validateCommand(
  cmd: string
): { ok: true } | { ok: false; reason: string } {
  if (!cmd || typeof cmd !== 'string') {
    return { ok: false, reason: 'Empty or invalid command' };
  }
  const base = cmd.trim().split(/\s+/)[0];
  if (!ALLOWED_COMMANDS.has(base)) {
    return { ok: false, reason: `Command '${base}' not in whitelist` };
  }
  if (
    cmd.includes('&&') ||
    cmd.includes('||') ||
    cmd.includes('|') ||
    cmd.includes(';') ||
    cmd.includes('`')
  ) {
    return { ok: false, reason: 'Chaining operators not allowed' };
  }
  if (cmd.includes('$(') || cmd.includes('${')) {
    return { ok: false, reason: 'Command substitution not allowed' };
  }
  // 校验参数: 禁止危险的代码执行标志
  const tokens = cmd.trim().split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    if (DANGEROUS_FLAGS.has(tokens[i])) {
      return { ok: false, reason: `Dangerous flag '${tokens[i]}' not allowed` };
    }
  }
  return { ok: true };
}
