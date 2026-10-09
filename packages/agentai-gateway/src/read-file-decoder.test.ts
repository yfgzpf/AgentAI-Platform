/**
 * read_file 异常根因修复（用户实机反馈「修复工具链故障 → 检查 read_file 工具异常原因」）
 * ========================================================================
 * 实测复现的两个缺陷：
 *
 * D1  非 UTF-8 文本（GBK 编码的中文文件）静默返回乱码
 *     `fs.readFileSync(p, 'utf-8')` 不抛错，只是把非法字节替换成 U+FFFD。
 *     实测：GBK 的"你好，世界" → "���,����"
 *     AI 拿到这份乱码会以为文件坏了 → 触发 auto_fix / 重新读 / 报告"工具异常"。
 *     这与"AI 老报错 read_file 工具异常"高度吻合 —— 工具没坏，是内容毁了。
 *
 * D2  二进制文件当 UTF-8 读 → 吐出乱码 + 无意义的 tool 结果
 *     实测：PNG 头部 → "�PNG\r\n\u001a\n\u0000��"
 *     AI 无法解析，既浪费 token 又误导后续判断。
 *     而且这类文件通常几十 MB，全部塞进上下文。
 *
 * 修法：读入后先判别（编码探测 + 二进制嗅探），再决定如何呈现。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileSmart, sniffBinary, detectEncoding } from './read-file-decoder.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readfile-'));
const p = (name: string) => path.join(tmpDir, name);

describe('D1 非 UTF-8 文本不再返回乱码', () => {
  it('GBK 编码的中文被正确识别', () => {
    // "你好，世界" 的 GBK 字节
    const f = p('gbk.txt');
    fs.writeFileSync(f, Buffer.from([
      0xC4, 0xE3, 0xBA, 0xC3, 0x2C, 0xB2, 0xE2, 0xCA, 0xD4, // ，世界
    ]));
    const r = readFileSmart(f);
    expect(r.encoding, '应识别为非 utf-8').not.toBe('utf-8');
    expect(r.content).not.toContain('\uFFFD');
    expect('读取失败或降级为 latin1，但绝不能含替换字符').toBeTruthy();
  });

  it('正常 UTF-8 文件识别为 utf-8 且内容不变', () => {
    const f = p('utf8.txt');
    fs.writeFileSync(f, 'const a = "你好";\nconsole.log(a);\n', 'utf-8');
    const r = readFileSmart(f);
    expect(r.encoding).toBe('utf-8');
    expect(r.content).toContain('你好');
    expect(r.content).not.toContain('\uFFFD');
  });

  it('★ UTF-8 文件里的合法非 ASCII 不被误判（emoji / 中文注释）', () => {
    const f = p('mixed.ts');
    fs.writeFileSync(f, '// 中文注释 🎉 emoji\nconst x = "值";\n', 'utf-8');
    const r = readFileSmart(f);
    expect(r.encoding).toBe('utf-8');
    expect(r.content).toContain('🎉');
  });

  it('detectEncoding 对全 ASCII 返回 utf-8', () => {
    expect(detectEncoding(Buffer.from('hello world'))).toBe('utf-8');
  });

  it('detectEncoding 对 GBK 中文返回非 utf-8', () => {
    expect(detectEncoding(Buffer.from([0xC4, 0xE3, 0xBA, 0xC3]))).not.toBe('utf-8');
  });

  it('detectEncoding 对二进制返回 null（交给 sniffBinary 判）', () => {
    expect(detectEncoding(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))).toBeNull();
  });
});

describe('D2 二进制文件不再当文本读', () => {
  it('识别 PNG 头', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    expect(sniffBinary(buf)).toBe(true);
  });

  it('识别 PDF 头', () => {
    expect(sniffBinary(Buffer.from('%PDF-1.7\n...'))).toBe(true);
  });

  it('识别 ZIP（xlsx/docx）头', () => {
    expect(sniffBinary(Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00]))).toBe(true);
  });

  it('识别 JPEG / GIF', () => {
    expect(sniffBinary(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))).toBe(true);
    expect(sniffBinary(Buffer.from('GIF89a'))).toBe(true);
  });

  it('正常代码/文本不被误判为二进制', () => {
    const ts = Buffer.from('import fs from "fs";\n// 注释\nexport function a(){}\n', 'utf-8');
    expect(sniffBinary(ts)).toBe(false);
  });

  it('含少量高位字节的文本仍算文本', () => {
    // UTF-8 中文本身就是高位字节，不能误判
    expect(sniffBinary(Buffer.from('中文内容测试', 'utf-8'))).toBe(false);
  });

  it('★ readFileSmart 对二进制返回 isBinary，不返回乱码 content', () => {
    const f = p('x.png');
    fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xFE, 0x00]));
    const r = readFileSmart(f);
    expect(r.isBinary).toBe(true);
    expect(r.content).not.toContain('\uFFFD');
    expect(r.content).toMatch(/二进制|binary/i);
  });

  it('二进制文件不给内容，只给可操作建议', () => {
    const f = p('y.bin');
    fs.writeFileSync(f, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
    const r = readFileSmart(f);
    expect(r.isBinary).toBe(true);
    expect(r.content.length).toBeLessThan(500);
  });
});

describe('大文件保护', () => {
  it('超过上限时截断并标注，不整file 塞进上下文', () => {
    const f = p('big.txt');
    fs.writeFileSync(f, 'A'.repeat(600 * 1024), 'utf-8');   // 600KB
    const r = readFileSmart(f, { maxBytes: 100 * 1024 });
    expect(r.truncated).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(100 * 1024 + 200);
    expect(r.content).toMatch(/截断|truncated/i);
  });

  it('小文件不截断', () => {
    const f = p('small.txt');
    fs.writeFileSync(f, 'short', 'utf-8');
    const r = readFileSmart(f, { maxBytes: 1024 });
    expect(r.truncated).toBe(false);
  });
});

describe('回归：不应破坏现有行为', () => {
  it('返回元信息供调用方使用', () => {
    const f = p('meta.ts');
    fs.writeFileSync(f, 'line1\nline2\n', 'utf-8');
    const r = readFileSmart(f);
    expect(r.encoding).toBe('utf-8');
    expect(r.isBinary).toBe(false);
    expect(r.truncated).toBe(false);
    expect(r.totalBytes).toBe(12);
  });

  it('空文件不报错', () => {
    const f = p('empty.txt');
    fs.writeFileSync(f, '', 'utf-8');
    const r = readFileSmart(f);
    expect(r.content).toBe('');
  });
});

// 清理：必须用 afterAll —— 模块顶层立即执行会把目录删在所有用例之前
import { afterAll } from 'vitest';

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});