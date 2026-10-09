/**
 * Monaco 离线化引导 (Vite ESM 方案 + 按需语言)
 * --------------------------------------------------------
 * 默认 @monaco-editor/react 的 loader 会从 jsdelivr CDN 拉取 monaco 内核,
 * 在离线 / 内网 / Tauri 桌面环境会加载失败。
 *
 * 本模块:
 *   1. 使用 monaco-editor 精简内核 (editor.api) 注入 loader, 零外网请求
 *   2. 只注册项目实际使用的语言 (对照 MonacoEditor 的 EXT_LANG_MAP),
 *      不引入 bicep/pascaligo 等 70+ 冷门语言贡献, 控制编辑器 chunk 体积
 *   3. 注册 Vite 本地打包的语言 worker (TS/JS/JSON/CSS/HTML 有诊断与补全)
 *
 * 必须在任何 <Editor /> 渲染前执行一次 (由 MonacoEditor.tsx 顶部副作用导入保证)。
 */
import { loader } from '@monaco-editor/react';
// 精简内核: standalone 编辑器核心, 不含任何语言注册
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

// ── 高级语言服务 (worker 提供诊断/补全/校验) ──
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'; // ts + js 共用 ts.worker
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution'; // css/scss/less
import 'monaco-editor/esm/vs/language/html/monaco.contribution'; // html/handlebars/razor

// ── Monarch 语法高亮 (项目语言白名单, 无 worker 的轻量语言) ──
// 注意: JSON 没有独立的 basic-languages 模块, 它的高级语言服务在 language/json/ 中已导入
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
// 注意: monaco 0.50.0 没有 c/c.contribution, C 语言高亮已合并到 cpp 中
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/bat/bat.contribution';
import 'monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution';

// Vite worker 入口 (?worker 生成独立 chunk, 仅编辑器实例化时加载)
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

let configured = false;

export function setupMonaco(): void {
  if (configured) return;
  configured = true;

  // 注入本地打包的 monaco, 覆盖 @monaco-editor/react 默认的 CDN 加载
  loader.config({ monaco });

  // 注册本地语言 worker (无匹配语言时回落到基础 editor worker)
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new jsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker();
        case 'typescript':
        case 'javascript':
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };
}

setupMonaco();
