/**
 * evidence-path.test.ts — 证据图片前端可打开 (2026-10-17)
 * ----------------------------------------------------------------
 * 实机事故: 前端聊天里显示「📎 已生成图片: poc-01-unauth-recommend-200.png」
 * 但图裂开, 用户反馈"无法在线打开还要去复制打开"。
 *
 * 查证结论 (对照真实工作区 F:/目录已检查/澳彩/.agentai/evidence/):
 *   磁盘上真实文件叫 poc1-unauth-api.png / poc2-auth-missing.png,
 *   **poc-01-unauth-recommend-200.png 根本不存在** —— 是模型凭印象编的名字。
 *
 * 本文件锁死的不变量:
 *   ① save_evidence 的 output 带机器可读路径标记 (前端据此用真实路径, 不猜名字)
 *   ② save_evidence 支持自定义文件名 (让磁盘名与 AI 汇报的名一致)
 *   ③ 自定义文件名必须防路径穿越 (否则模型能让它往工作区外写文件)
 *   ④ download 端点支持"相对工作区的裸路径"且限定在 .agentai/ 内 (中文路径 + 多工作区)
 *   ⑤ CORS 暴露 Content-Disposition (前端要拿下载文件名)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const toolsSrc = readFileSync(join(ROOT, 'packages/agentai-gateway/src/tools.ts'), 'utf-8');
const filesSrc = readFileSync(join(ROOT, 'packages/agentai-gateway/src/routes/files.ts'), 'utf-8');
const appSrc = readFileSync(join(ROOT, 'packages/agentai-gateway/src/app.ts'), 'utf-8');
const chatUtilsSrc = readFileSync(join(ROOT, 'packages/agentai-gui/src/components/chat/chat-utils.ts'), 'utf-8');
const threadSrc = readFileSync(join(ROOT, 'packages/agentai-gui/src/components/Thread.tsx'), 'utf-8');

describe('① save_evidence 输出机器可读路径标记', () => {
  it('output 含 EVIDENCE_PATHS 标记 (前端靠它拿真实路径)', () => {
    expect(toolsSrc).toMatch(/EVIDENCE_PATHS: \$\{out\.join\(' \| '\)\}/);
  });
  it('标记必须在 output 末尾且 data.evidencePaths 同源', () => {
    expect(toolsSrc).toMatch(/data: \{ evidencePaths: out, dir: evDir \}/);
  });
});

describe('② save_evidence 支持自定义文件名', () => {
  it('imageBase64 走 safeName(args.filename, 默认名)', () => {
    expect(toolsSrc).toMatch(/safeName\(args\.filename, `screenshot-\$\{stamp\}\.png`\)/);
  });
  it('saveText 走 safeName(args.textFilename, 默认名)', () => {
    expect(toolsSrc).toMatch(/safeName\(args\.textFilename, `response-\$\{stamp\}\.txt`\)/);
  });
  it('schema 声明 filename / textFilename 两个参数', () => {
    expect(toolsSrc).toMatch(/filename: \{ type: 'string'/);
    expect(toolsSrc).toMatch(/textFilename: \{ type: 'string'/);
  });
});

describe('③ 自定义文件名防路径穿越 (安全底线)', () => {
  it('先剥目录成分再清洗字符', () => {
    expect(toolsSrc).toMatch(/split\(\/\[\\\\\/\]\/\)\.pop\(\) \|\| s/);
  });
  it('非白名单字符一律替换掉, 并挡掉以点开头的隐藏名', () => {
    expect(toolsSrc).toMatch(/replace\(\/\[\^A-Za-z0-9\._-\]\/g, '_'\)/);
    expect(toolsSrc).toContain(`replace(/^\\.+/, '')`);
  });
  it('无有效扩展名 → 回落默认名 (防写成无类型文件)', () => {
    expect(toolsSrc).toMatch(/if \(!cleaned \|\| !\/\\\.\[a-z0-9\]\{2,5\}\$\/i\.test\(cleaned\)\) return fallback/);
  });
  it('纵深防御: 解析后必须仍在 evDir 内', () => {
    expect(toolsSrc).toMatch(/path\.resolve\(finalPath\)\.startsWith\(path\.resolve\(evDir\) \+ path\.sep\)/);
  });
});

describe('④ download 端点能解析工作区内的相对路径', () => {
  it('优先用请求级 workspace (多工作区不能读错项目)', () => {
    expect(filesSrc).toMatch(/const ws = currentRequestWorkspace\(\) \|\| WorkspaceManager\.getInstance\(\)\.projectDir/);
  });
  it('反斜杠归一化 (Windows 中文路径坑: 反斜杠被当转义符吞掉)', () => {
    // 用 includes 而非正则 —— 源码是 .replace(/\\/g, '/'), 正则里要写四层反斜杠,
    // 可读性极差且极易写错(本文件已踩过一次)。
    expect(filesSrc).toContain(`replace(/\\\\/g, '/')`);
  });
  it('限定在 .agentai/ 内, 不把工作区整个当搜索域', () => {
    expect(filesSrc).toMatch(/alt\.startsWith\(path\.resolve\(`\$\{normWs\}\/\.agentai`\) \+ path\.sep\)/);
  });
  it('保留旧的 projectDir 上两级兜底 (旧行为不能丢)', () => {
    expect(filesSrc).toMatch(/wm\.projectDir, '\.\.', '\.\.'/);
  });
});

describe('⑤ CORS 暴露 Content-Disposition', () => {
  it('exposedHeaders 含 Content-Disposition 与 Content-Length', () => {
    expect(appSrc).toMatch(/exposedHeaders: \[[^\]]*'Content-Disposition'[^\]]*\]/);
  });
});

describe('⑥ 前端: 用真实路径渲染证据图片', () => {
  it('save_evidence 分支读 data.evidencePaths (不再从文字猜文件名)', () => {
    expect(chatUtilsSrc).toMatch(/toolName === 'save_evidence' && Array\.isArray\(parsed\.evidencePaths\)/);
  });
  it('只取图片扩展名 (.txt 响应日志不当图片渲染)', () => {
    expect(chatUtilsSrc).toMatch(/\\.\(png\|jpe\?g\|gif\|webp\|bmp\|ico\)\$\/i\.test/);
  });
  it('走 kind:image + 网关绝对地址 (与已验证可显示的浏览器截图同一条路)', () => {
    expect(chatUtilsSrc).toMatch(/kind: 'image' as const/);
    expect(chatUtilsSrc).toMatch(/gatewayHttp\}\/api\/files\/download\?path=/);
  });
  it('文本兜底分支不再用相对路径 (裂图第二重原因)', () => {
    // 反断言: 不再出现裸的 ![..](/api/files/download?path=
    expect(chatUtilsSrc).not.toMatch(/!\[\\\$\{imgName\}\]\(\/api\/files\/download/);
    expect(chatUtilsSrc).toMatch(/const dlUrl = `\$\{gatewayHttp\}\/api\/files\/download/);
  });
});

describe('⑦ 前端: 点击打开 + 保存 (实机诉求"无法在线打开还要去复制打开")', () => {
  it('ImageGallery 全屏弹窗有「打开原图」与「保存」', () => {
    expect(threadSrc).toMatch(/🔗 打开原图/);
    expect(threadSrc).toMatch(/💾 保存/);
  });
  it('ImageCard 单张卡也有打开/保存入口', () => {
    expect(threadSrc).toMatch(/title="在新窗口打开原图"/);
    expect(threadSrc).toMatch(/title="保存到本地\(提交平台附件用\)"/);
  });
  it('downloadImage 跨源必须 fetch→blob, 不能直接 a[download]', () => {
    expect(threadSrc).toMatch(/async function downloadImage\(/);
    expect(threadSrc).toMatch(/URL\.createObjectURL\(blob\)/);
    expect(threadSrc).toMatch(/a\.download = filename/);
  });
  it('下载失败降级为新窗口打开 (至少能右键另存)', () => {
    expect(threadSrc).toMatch(/window\.open\(src, '_blank', 'noopener'\)/);
  });
  it('文件名取 filePath 末段, 不再用 alt+".png" (会拼出 xxx.png.png)', () => {
    expect(threadSrc).toMatch(/const downloadNameOf = /);
    expect(threadSrc).not.toMatch(/a\.download = \(alt \|\| 'image'\) \+ '\.png'/);
  });
  it('区块标题按内容自适应 (证据截图不该叫"浏览器截图")', () => {
    expect(threadSrc).toMatch(/证据截图 \(\$\{segments\.length\}张\)/);
  });
});
