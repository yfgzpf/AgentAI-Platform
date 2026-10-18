/**
 * chat-utils — ChatView 拆出的纯函数工具 (2026-10-12)
 * --------------------------------------------------
 * 从 ChatView.tsx (原 2454 行) 拆出, 两个零依赖纯函数:
 *   - generateConversationSummary: 前端本地生成对话摘要 (不调 LLM)
 *   - detectAndInsertImage:       检测工具结果中的图片数据并插入 image segment
 *
 * 原位置: ChatView.tsx:32-71 (summary) / :77-250 (image detect)。
 * 两函数均无 JSX / 无 React 依赖, 可独立单测。
 * ⚠️ 签名与原代码逐字一致 (含 any) —— 拆分只搬代码, 不做类型收敛。
 */

/** 自动生成对话摘要 (前端本地压缩, 不调LLM) */
export function generateConversationSummary(messages: any[]): string {
  const userMsgs = messages.filter(m => m.role === 'user');
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const toolCalls = messages.flatMap(m => m.segments?.filter((s: any) => s.kind === 'tool') || []);

  // 提取用户需求
  const userNeeds = userMsgs.map(m =>
    m.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('').slice(0, 100)
  ).filter(Boolean);

  // 提取AI完成的关键操作
  const toolNames = [...new Set(toolCalls.map((t: any) => t.name))];
  const completedOps = toolNames.length > 0
    ? `已执行操作: ${toolNames.join(', ')}`
    : '';

  // 提取AI回复摘要
  const assistantSummaries = assistantMsgs.slice(-3).map(m => {
    const text = m.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('').slice(0, 150);
    return text;
  }).filter(Boolean);

  const lines = [
    '📋 **上一轮对话摘要** (自动生成)',
    '',
    `**用户需求**: ${(userNeeds || []).slice(-3).join(' → ')}`,
  ];
  if (completedOps) lines.push(`**${completedOps}**`);
  if (assistantSummaries.length > 0) {
    lines.push('');
    lines.push('**最近回复要点**:');
    assistantSummaries.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  lines.push('');
  lines.push('---');
  lines.push('*以上为上下文压缩摘要, AI 可基于此继续对话*');

  return lines.join('\n');
}

/**
 * 检测工具结果中的图片数据并插入 image segment
 * 支持: imageBase64 / imageUrl / screenshot_data
 */
export function detectAndInsertImage(
  botId: string,
  toolName: string,
  result: string | undefined,
  updateMessage: (id: string, fn: (m: any) => any) => void,
  onImageDetected?: (url: string, alt: string, filePath?: string) => void,
) {
  if (!result) return;
  // 黑名单: 以下工具永远不会产生图片, 跳过检测
  const NON_IMAGE_TOOLS = new Set(['run_background', 'run_command', 'run_code', 'read_file', 'write_file', 'edit_file', 'execute_command', 'Bash', 'PowerShell', 'list_directory', 'directory_tree', 'search_content', 'search_files', 'glob', 'get_file_info', 'find_references', 'get_outline', 'get_symbols', 'search_codebase']);
  if (NON_IMAGE_TOOLS.has(toolName)) return;
  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;

    // ═══ 提取待插入的图片候选 (url/base64) ═══
    let candidateUrl: string | undefined;
    let candidateBase64: string | undefined;
    let candidateAlt: string | undefined;
    let candidateFilePath: string | undefined;

    // 1. 桌面截图: desktop_automate screenshot 返回 screenshot_data
    if (toolName === 'desktop_automate' && parsed.screenshot_data?.base64) {
      candidateBase64 = parsed.screenshot_data.base64;
      candidateAlt = parsed.screenshot_data.alt || '桌面截图';
      candidateFilePath = parsed.screenshot_data.path;
    }

    // 2. 浏览器截图: browser_screenshot 返回 imageBase64
    else if ((toolName === 'browser_screenshot' || toolName === 'browser_screenshot_full') && parsed.imageBase64) {
      candidateBase64 = parsed.imageBase64;
      candidateAlt = '浏览器截图';
    }

    // 3. 图片生成: generate_image 优先使用 localPath
    else if (toolName === 'generate_image') {
      if (parsed.localPath) {
        const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
        candidateUrl = `${gatewayHttp}/api/files/download?path=${encodeURIComponent(parsed.localPath)}`;
        candidateAlt = parsed.prompt || 'AI 生成图片';
        candidateFilePath = parsed.localPath;
      } else if (parsed.imageUrl || parsed.url) {
        candidateUrl = parsed.imageUrl || parsed.url;
        candidateAlt = parsed.prompt || 'AI图片';
      }
    }

    // 4. 通用检测: 只要有 imageUrl/imageBase64 字段
    else if (parsed.imageUrl || parsed.imageBase64) {
      candidateUrl = parsed.imageUrl;
      candidateBase64 = parsed.imageBase64;
      candidateAlt = parsed.alt || toolName;
    }

    // 5. 证据图片 (2026-10-17 实机事故修复):
    //   save_evidence 返回 data.evidencePaths = **真实绝对路径**数组, 但这个分支
    //   以前完全没接 → 前端掉进下面的文本正则兜底, 从模型文字里抓文件名,
    //   而模型经常**凭印象编一个名字**(实机编出 `poc-01-unauth-recommend-200.png`,
    //   磁盘上真实文件叫 `poc1-unauth-api.png`) → 路径必然 404 → 裂图。
    //
    //   这里用**后端给的真实路径**构造 download URL, 并走 kind:'image' ——
    //   与"浏览器截图"同一条已验证能显示的通路(base64 分支胜出/ url 分支带网关绝对地址)。
    //   ⚠️ 只取图片扩展名: save_evidence 也会存 .txt 响应日志, 那不是图片,
    //   当图片渲染必然裂图, 应留给文本路径。
    else if (toolName === 'save_evidence' && Array.isArray(parsed.evidencePaths)) {
      const imgPaths = (parsed.evidencePaths as string[])
        .filter((p: string) => /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(String(p).trim()));
      if (imgPaths.length > 0) {
        const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
        // 多张证据 → 一次性插入多段(同一条消息里应能看到全部截图)
        updateMessage(botId, (m: any) => {
          const existing = new Set(
            (m.segments || []).filter((s: any) => s.kind === 'image').map((s: any) => s.filePath),
          );
          const add = imgPaths
            .filter((p: string) => !existing.has(p))
            .map((p: string) => ({
              kind: 'image' as const,
              url: `${gatewayHttp}/api/files/download?path=${encodeURIComponent(p)}`,
              alt: `证据截图: ${p.split(/[\\/]/).pop() || p}`,
              filePath: p,
            }));
          if (add.length === 0) return m;
          return { ...m, segments: [...m.segments, ...add] };
        });
        for (const p of imgPaths) {
          const alt = `证据截图: ${p.split(/[\\/]/).pop() || p}`;
          onImageDetected?.(`${gatewayHttp}/api/files/download?path=${encodeURIComponent(p)}`, alt, p);
        }
        return;
      }
    }

    // ═══ 图片去重: 已有相同 url 或 base64 的 image segment 则跳过 ═══
    if (candidateUrl || candidateBase64) {
      candidateAlt = candidateAlt || '图片';
      updateMessage(botId, (m: any) => {
        const existing = m.segments?.find((s: any) => {
          if (s.kind !== 'image') return false;
          if (candidateUrl && s.url === candidateUrl) return true;
          if (candidateBase64 && s.base64 === candidateBase64) return true;
          return false;
        });
        if (existing) return m; // 重复, 不插入
        return {
          ...m,
          segments: [...m.segments, {
            kind: 'image',
            url: candidateUrl,
            base64: candidateBase64,
            alt: candidateAlt,
            filePath: candidateFilePath,
          }],
        };
      });
      if (candidateUrl || candidateFilePath) {
        const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
        const imgDataUrl = candidateFilePath
          ? `${gatewayHttp}/api/files/download?path=${encodeURIComponent(candidateFilePath)}`
          : candidateUrl;
        onImageDetected?.(imgDataUrl || '', candidateAlt!, candidateFilePath);
      }
      return;
    }
  } catch {
    // result 不是 JSON — 检查是否包含图片 URL 或文件路径
    const text = String(result);

    // 0. 优先检测本地文件路径 (格式: "FILE: /path/to/img.png") — 无 CORS 问题
    const fileMatch = text.match(/FILE:\s*([^\s\n]+)/i);
    if (fileMatch) {
      const filePath = fileMatch[1];
      const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
      const imgUrl = `${gatewayHttp}/api/files/download?path=${encodeURIComponent(filePath)}`;
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: imgUrl,
          alt: 'AI 生成图片',
          filePath,
        }],
      }));
      return;
    }

    // 1. 从 output 字符串中提取 URL (格式: "URL: https://...")
    const urlMatch = text.match(/URL:\s*(https?:\/\/[^\s\n]+)/i);
    if (urlMatch) {
      const imageUrl = urlMatch[1];
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: imageUrl,
          alt: 'AI 生成图片',
        }],
      }));
      return;
    }

    // 2. 从 Markdown 链接中提取 URL (格式: ![alt](url) 或 [text](url))
    const mdImageMatch = text.match(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/i);
    if (mdImageMatch) {
      const imageUrl = mdImageMatch[2];
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: imageUrl,
          alt: mdImageMatch[1] || 'AI 生成图片',
        }],
      }));
      return;
    }

    // 3. 从 Markdown 链接中提取 URL (格式: [text](url)，排除 agentai:// 协议)
    const mdLinkMatch = text.match(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/i);
    if (mdLinkMatch && !mdLinkMatch[2].startsWith('agentai://')) {
      const imageUrl = mdLinkMatch[2];
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: imageUrl,
          alt: mdLinkMatch[1] || 'AI 生成图片',
        }],
      }));
      return;
    }

    // 4. 检查是否包含图片文件路径 (排除 file:/// 协议路径和系统路径)
    const textClean = text.replace(/file:\/\/\/?/gi, '');
    if (textClean !== text) return; // 含 file:// 协议的不是图片
    const nonImageSystemPaths = /\\windows\\|\/windows\/|system32|cmd\.exe|powershell\.exe|Program\s*Files|favicon\.svg|icon\.png|logo\.jpg/i;
    if (nonImageSystemPaths.test(text)) return;
    const imgMatch = text.match(/([^\s`'"]+\.(png|jpg|jpeg|gif|webp|bmp))/i);
    if (imgMatch && !/^\//.test(imgMatch[1])) {
      // SVG 文件通常不是生成的图片，跳过
      if (imgMatch[2] === 'svg') return;
      const imgPath = imgMatch[1];
      const imgName = imgPath.split(/[\\/]/).pop() || imgPath;
      // ⚠️ 2026-10-17: 必须是**网关绝对地址**, 不能用相对 `/api/files/...`。
      //   相对路径在 GUI 与网关不同源时会打到前端自己(5173) 而不是网关(18789),
      //   开发模式下必然裂图 —— 这是裂图的第二重原因。
      //   与本文件上方 generate_image 分支(L92-94) 的既有写法保持一致。
      const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
      const dlUrl = `${gatewayHttp}/api/files/download?path=${encodeURIComponent(imgPath)}`;
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'text',
          // 补一句提示: 这类"文字里提到的图片"可能只是文件名被提到, 并不真实存在。
          // 实机里模型经常编名字(poc-01-xxx.png 磁盘上根本没有), 所以不承诺能打开。
          text: `\n\n> 🖼️ **已生成图片**: [${imgName}](${dlUrl})\n\n![${imgName}](${dlUrl})\n\n> ℹ️ 若图裂开, 说明该文件在磁盘上不存在(常见于只在文字里被提到)。已用 save_evidence 落盘的截图会显示在图片区。\n`,
        }],
      }));
      return;
    }
  }
}
