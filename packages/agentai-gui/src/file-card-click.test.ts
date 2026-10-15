/**
 * FileCard 点击链路回归测试 (2026-10-15)
 * ============================================================================
 * 背景: 用户反馈"AI 收尾时输出的生成文件是死码, 不能点击打开查看"。
 * 根因 (FileCard.tsx 两处):
 *   ① FilesFromToolSegment 循环里 `if (path)` 静默丢弃路径抽不到的卡片;
 *      且 run_code/generate_image 等路径只出现在 result 文本里的工具完全没被处理
 *      → "生成文件"列表空或不可点。
 *   ② write/edit 卡片展开按钮的条件 `{content && ...}` 在 content='' (write_file
 *      上游只传了 path 没 content) 时隐藏按钮 → 卡片死头, 无查看入口。
 * 本测试锁死修复, 防回归。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

const gui = nodePath.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(nodePath.join(gui, rel), 'utf-8');
const fileCardSrc = read('src/components/FileCard.tsx');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const src = strip(fileCardSrc);

describe('FileCard 点击链路 (生成文件可打开, 2026-10-15)', () => {
  it('① 路径抽取有 result 兜底 (run_code/generate_* 的路径在 result 文本里)', () => {
    // pathFromResult 辅助函数存在 (箭头函数, 允许 : string 类型标注), 且正则命中"已生成/created/saved"等常见输出格式
    expect(src).toMatch(/const pathFromResult\s*=\s*\(\)\s*(?::\s*string)?\s*=>/);
    expect(src).toMatch(/(?:已生成|已创建|saved?|wrote|created|output)/);
  });

  it('① write/create/edit 卡片的路径兜底走 pathFromResult (args 没 path 时不丢)', () => {
    // 三个分支的 path 计算行都带 pathFromResult() 兜底
    const pathLines = (src.match(/pathFromResult\(\)/g) || []).length;
    expect(pathLines, '至少 3 处兜底 (write + edit + read)').toBeGreaterThanOrEqual(3);
  });

  it('① 新增分支: run_code/generate_image/generate_diagram/generate_video 也出卡片', () => {
    expect(src).toMatch(/run_code.*generate_image.*generate_diagram.*generate_video/s);
    // 该分支用 pathFromResult() 抽路径
    expect(src).toMatch(/n === 'run_code'/);
  });

  it('② write/edit 卡片展开按钮不再被 content="" 卡死 (有 diffStats 也能查看)', () => {
    // 新条件: content || oldContent || diffStats (任一非空就显示)
    const m = src.match(
      /content\s*\|\|\s*oldContent\s*\|\|\s*\(diffStats\s*&&\s*\(diffStats\.added\s*>\s*0\s*\|\|\s*diffStats\.removed\s*>\s*0\)\)/
    );
    expect(m, '展开按钮条件应含 content||oldContent||diffStats').toBeTruthy();
    // 反僵尸: 不许残留旧的 {content &&  (那是死头 bug)
    expect(src).not.toMatch(/\{content && \(?\s*<button/);
  });

  it('② read 卡片的"查看内容"按钮始终可点 (不依赖 content)', () => {
    // read 模式 toggleInline 不依赖 content 初值 (会 fetch 兜底)
    expect(src).toMatch(/void toggleInline\(\)/);
    // 且 toggleInline 在 content/fetched 都为空时会 fetch /v1/files/read
    expect(src).toMatch(/content != null \|\| fetched != null/);
    expect(src).toMatch(/\/v1\/files\/read\?path=/);
  });

  it('② write/edit 卡片展开内容区有"内容缺失"占位 (上游只传 path 时不空白)', () => {
    // 展开容器 {expanded && ...} 内, content/oldContent 都缺时渲染占位文案, 不空白
    expect(src).toMatch(/（内容未在消息里携带/);
    // 占位分支: content || oldContent ? (...) : (占位)
    expect(src).toMatch(/content \|\| oldContent \?/);
  });

  it('①② 卡片"编辑器"按钮走 agentai:open-file-pending 事件 (不静默失败)', () => {
    expect(src).toMatch(/agentai:open-file-pending/);
    expect(src).toMatch(/agentai:navigate/);
  });
});
