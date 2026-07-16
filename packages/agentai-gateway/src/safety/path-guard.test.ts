/**
 * path-guard 单元测试
 * ----------------------------------------------------
 * 验证: 白名单路径放行、系统路径拒绝、未配置时使用默认 cwd
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { isPathAllowed, getAllowedRoots } from './path-guard.js';

describe('isPathAllowed', () => {
  const originalRoots = process.env.AGENTAI_FS_ALLOWED_ROOTS;
  const originalWorkspace = process.env.AGENTAI_WORKSPACE;

  beforeEach(() => {
    delete process.env.AGENTAI_FS_ALLOWED_ROOTS;
    delete process.env.AGENTAI_WORKSPACE;
  });

  afterEach(() => {
    if (originalRoots === undefined) delete process.env.AGENTAI_FS_ALLOWED_ROOTS;
    else process.env.AGENTAI_FS_ALLOWED_ROOTS = originalRoots;
    if (originalWorkspace === undefined) delete process.env.AGENTAI_WORKSPACE;
    else process.env.AGENTAI_WORKSPACE = originalWorkspace;
  });

  it('默认允许 cwd', () => {
    expect(isPathAllowed(process.cwd())).toBe(true);
  });

  it('拒绝 Windows 系统目录', () => {
    expect(isPathAllowed('C:\\Windows\\System32')).toBe(false);
  });

  it('拒绝 Program Files', () => {
    expect(isPathAllowed('C:\\Program Files')).toBe(false);
  });

  it('env 配置的根路径放行', () => {
    process.env.AGENTAI_FS_ALLOWED_ROOTS = 'D:\\projects,C:\\work';
    expect(isPathAllowed('D:\\projects\\foo')).toBe(true);
    expect(isPathAllowed('C:\\work\\bar')).toBe(true);
  });

  it('env 路径白名单外拒绝', () => {
    process.env.AGENTAI_FS_ALLOWED_ROOTS = 'D:\\projects';
    expect(isPathAllowed('C:\\other')).toBe(false);
  });

  it('AGENTAI_WORKSPACE 也放行', () => {
    process.env.AGENTAI_WORKSPACE = 'E:\\workspace';
    expect(isPathAllowed('E:\\workspace\\anywhere')).toBe(true);
  });
});

describe('getAllowedRoots', () => {
  it('返回字符串数组', () => {
    const roots = getAllowedRoots();
    expect(Array.isArray(roots)).toBe(true);
    expect(roots.length).toBeGreaterThan(0);
  });
});
