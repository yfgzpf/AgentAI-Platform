/**
 * @提及文件 回归契约测试 (2026-10-15)
 * ============================================================================
 * 背景: @提及文件 曾"没真实实现" —— 两个叠加 bug:
 *   ① Composer 取 /v1/fs/list 响应错字段: 端点返回 { entries: [...] }(type:'directory'|'file'),
 *      代码却取 data.files(不存在) → 退化成 data 对象 → 非数组 filter 跑不起来 → atFiles 恒空
 *   ② ChatView 调 <Composer> 时没传 workspaceDir → ws 恒为 '' → 弹层逻辑 `if(!ws) return` 短路
 * 本测试锁死修复, 防回归。走源码文本断言 + stripComments (修复点注释会引用坏代码, 需先剥注释)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

// 本文件在 packages/agentai-gui/src/at-mention.test.ts
//   __dirname/.. = packages/agentai-gui ; 再加 /.. = packages/
const guiPkg = nodePath.resolve(__dirname, '..');        // packages/agentai-gui
const packagesDir = nodePath.resolve(__dirname, '..', '..'); // packages/
const read = (rel: string) => readFileSync(nodePath.join(guiPkg, rel), 'utf-8');
const readGw = (rel: string) => readFileSync(nodePath.join(packagesDir, rel), 'utf-8');
const composerSrc = read('src/components/Composer.tsx');
const chatViewSrc = read('src/components/ChatView.tsx');
const filesRouteSrc = readGw('agentai-gateway/src/routes/files.ts');

/** 剥注释 (与 AGENTS.md 规矩: 修复点注释里大量引用"原来是坏的", 朴素 grep 会误命中) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join('\n');
}
const composer = stripComments(composerSrc);
const chatView = stripComments(chatViewSrc);

describe('@提及文件 契约 (防回归)', () => {
  it('网关 /v1/fs/list 端点确实存在且返回 entries 字段', () => {
    expect(filesRouteSrc).toMatch(/filesRouter\.get\(\s*['"]\/v1\/fs\/list/);
    // 返回体用 entries (不是 files) — 修复点 ① 的依据
    expect(filesRouteSrc).toMatch(/res\.json\(\{\s*entries\s*\}\)/);
    // entry 的目录判断用 type (不是 isDirectory)
    expect(filesRouteSrc).toMatch(/type:\s*it\.isDirectory\(\)\s*\?\s*['"]directory['"]\s*:\s*['"]file['"]/);
  });

  it('Composer 取 /v1/fs/list 响应用的 entries (不是 data.files)', () => {
    // 修复点 ①: 响应字段 entries + 目录判 type
    expect(composer).toMatch(/data\??\.entries/);
    expect(composer).toMatch(/f\.type\s*===?\s*['"]directory['"]/);
    // 反僵尸: 不许残留旧的 data.files 取法 (那正是 bug)
    expect(composer).not.toMatch(/data\.files\b/);
  });

  it('ChatView 把 workspaceDir 传进 Composer (@提及列文件的根)', () => {
    // 修复点 ②: <Composer> 调用块必须有 workspaceDir=
    const cv = stripComments(chatViewSrc);
    expect(cv).toMatch(/<Composer[\s\S]*?workspaceDir\s*=/);
    // 传给它的值是非空标识符 (JSX 属性: workspaceDir={currentWorkspace}), 不是空串
    expect(cv).toMatch(/workspaceDir\s*=\s*\{?\s*[A-Za-z_]/);
    // 反僵尸: 不许是空串字面量 (那等于没传, 弹层仍短路)
    expect(cv).not.toMatch(/workspaceDir\s*=\s*['"]\s*['"]/);
  });

  it('Composer 的 @弹层逻辑: ws 为空才短路 (非空就真去 fetch)', () => {
    // 锁定 "if(!ws) return" 是唯一的短路, 确保传了 workspaceDir 后能真发请求
    expect(composer).toMatch(/const\s+ws\s*=\s*workspaceDir\s*\|\|\s*['"]/);
    expect(composer).toMatch(/if\s*\(\s*!ws\s*\)\s*return/);
  });
});
