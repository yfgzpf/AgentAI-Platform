/**
 * browser-engine 注入脚本的静态守卫
 *
 * 背景 (2026-10-11): 两个静默失效的坑同时存在, 且都不抛错、不崩溃 ——
 *   ① DEHYDRATE_JS 里混进了 TS 泛型 `new WeakMap<Element, number>()`,
 *      字符串绕过 tsc 直进浏览器 → SyntaxError: Missing initializer in const declaration
 *      → dehydrate() 恒抛"页面为空" → browser_extract(dehydration)/click_by_index/type_by_index 全废
 *   ② page.evaluate(字符串箭头函数) 在 Playwright 1.61 **不再自动调用**, 返回 undefined
 *      → scanElements() 恒返回 undefined → browser_scan / browser_snapshot 假报"浏览器未启动"
 *
 * 这两个测试不需要浏览器, 只做语法/语义断言, 但足以在下次同样翻车时立刻拦下。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { __INJECTED_SCRIPTS } from './browser-engine.js';

const { DEHYDRATE_JS } = __INJECTED_SCRIPTS;

describe('browser-engine 注入脚本', () => {
  it('DEHYDRATE_JS 是纯 JS 函数表达式 (不得混入 TS 语法)', () => {
    expect(DEHYDRATE_JS).toBeTruthy();
    expect(DEHYDRATE_JS.trim().startsWith('() =>')).toBe(true);
    // 纯 JS 解析: 一旦混入 <T> 泛型 / as X / : Type 这类 TS 语法, 这里就会炸
    expect(() => new Function('return (' + DEHYDRATE_JS + ')')).not.toThrow();
  });

  it('DEHYDRATE_JS 能包成 IIFE 求值 (Playwright 1.61 不再自动调用字符串箭头函数)', () => {
    const fn = new Function('return (' + DEHYDRATE_JS + ')()') as () => unknown;
    expect(typeof fn).toBe('function');
  });

  it('page.evaluate 不得裸传字符串标识符 (那会静默返回 undefined)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'browser-engine.ts'), 'utf8');
    expect(src, 'page.evaluate 不得裸传 SCAN_FN').not.toMatch(/page\.evaluate\(\s*SCAN_FN\s*\)/);
    expect(src, 'page.evaluate 不得裸传 DEHYDRATE_JS').not.toMatch(/page\.evaluate\(\s*DEHYDRATE_JS\s*\)/);
  });

  it('dehydrate 必须把 selector 搬到顶层, 索引工具不得再读 attrs.selector', () => {
    const src = fs.readFileSync(path.join(__dirname, 'browser-engine.ts'), 'utf8');
    // DEHYDRATE_JS 产出的是顶层 selector; 映射层漏搬过一次, 导致 clickByIndex/typeByIndex
    // 一律抛"缺少定位信息" (实测: 修复前两个工具都点不动, 修复后均返回"点击成功")
    expect(src, 'dehydrate 映射必须搬运 e.selector').toMatch(/selector:\s*e\.selector/);
    expect(src, '不得再读 el.attrs?.selector (那里永远没有 selector)').not.toMatch(/el\.attrs\?\.selector/);
  });
});
