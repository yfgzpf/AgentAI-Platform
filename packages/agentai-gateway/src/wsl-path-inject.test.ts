/**
 * wsl_exec: Windows PATH 注入 WSL 坏模式拦截 (2026-10-21, 富哥实锤)
 * ======================================================================
 * 事故: AI 照工具声明里的旧示例写
 *   export PATH=$PATH:/mnt/c/Program Files/... (值带空格又不加引号)
 *   → bash "not a valid identifier" / "syntax error near unexpected token"
 *   → 加密报错诱发 AI 反复重试同一条命令。
 * 根因两层: ① 工具声明示例本身就是不带引号的坏 pattern (文档教坏 AI)
 *          ② "手动把 Windows PATH 注入 WSL" 方向就错了 — WSL interop 已自动
 *             把 Windows PATH 转换 (分号→冒号, C:\→/mnt/c, 含空格处理好)
 *             追加进 Linux PATH, Windows 程序直接敲名即可调用。
 * 三层防线 (本文件锁死):
 *   D1 工具声明示例改引号写法 + Windows PATH 警示 (源码契约)
 *   D2 wsl_exec 执行前拦截裸空格 PATH 值, 给可行动修法 (行为断言)
 *   D3 失败建议 syntax error × export PATH 分支 (源码契约)
 * 不拦: 已加双引号 / 值无空格 / 反斜杠转义空格 (合法 bash 写法)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_SRC = readFileSync(path.resolve(__dirname, 'tools.ts'), 'utf-8');

let handlers: any;
beforeAll(async () => {
  handlers = (await import('./tools.ts')).EXTRA_HANDLERS;
});

describe('wsl_exec: Windows PATH 注入坏模式执行前拦截 (D2)', () => {
  it('① 裸空格 PATH 值 → 拦截 + 可行动修法 (不进 bash 报加密错误)', async () => {
    const r = await handlers.wsl_exec({
      command: 'bash',
      args: ['-lc', 'export PATH=$PATH:/mnt/c/Program Files/Git/cmd && which git'],
    });
    expect(r.success).toBe(false);
    expect(r.output).toContain('[WSL PATH INJECT]');
    // 修法一: 原值回显 + 引号写法 (AI 能直接抄)
    expect(r.output).toContain('export PATH="$PATH:/mnt/c/Program Files/Git/cmd"');
    // 修法二: 指明方向错了 — interop 已自动转换
    expect(r.output).toContain('interop');
    expect(r.output).toContain('根本不要手动注入 Windows PATH');
  }, 20000);

  it('② 已加双引号 → 不拦截 (no false positive)', async () => {
    const r = await handlers.wsl_exec({
      command: 'bash',
      args: ['-lc', 'export PATH="$PATH:/mnt/c/Program Files/Git/cmd" && which git'],
    });
    expect(r.output).not.toContain('[WSL PATH INJECT]');
  }, 60000);

  it('③ 无空格值 + && 后续命令 → 不拦截 (正常 go install 形态)', async () => {
    const r = await handlers.wsl_exec({
      command: 'bash',
      args: ['-lc', 'export PATH=$PATH:/root/go/bin && go version'],
    });
    expect(r.output).not.toContain('[WSL PATH INJECT]');
  }, 60000);

  it('④ 反斜杠转义空格 (Program\\ Files) → 不拦截 (合法 bash 写法)', async () => {
    const r = await handlers.wsl_exec({
      command: 'bash',
      args: ['-lc', 'export PATH=$PATH:/mnt/c/Program\\ Files/Git/cmd; which git'],
    });
    expect(r.output).not.toContain('[WSL PATH INJECT]');
  }, 60000);
});

describe('wsl_exec: 文档与建议两层防线 (D1/D3)', () => {
  it('⑤ D1 源码契约: 工具声明示例是引号写法 + 带 Windows PATH 警示', () => {
    // 文件里是 TS 单引号串源码: \\" 两字符, 运行时给 AI 显示 \" (合法 JSON 转义)
    expect(TOOLS_SRC).toContain('export PATH=\\\\"$PATH:/root/go/bin\\\\"');
    expect(TOOLS_SRC).toContain('不要把 Windows PATH 手动注入 WSL');
  });

  it('⑥ D3 源码契约: 失败建议有 syntax error × export PATH 分支', () => {
    expect(TOOLS_SRC).toMatch(/syntax error\|not a valid identifier\|unexpected token/);
    expect(TOOLS_SRC).toContain('export\\s+PATH');
  });

  it('⑦ D2 源码契约: 拦截判据只打裸空格 (转义空格不拦的注释在)', () => {
    expect(TOOLS_SRC).toContain('反斜杠转义的空格');
    expect(TOOLS_SRC).toContain('(^|[^\\\\])\\s');
  });
});
