/**
 * BrowserAutoShow — AI 调用浏览器工具时自动显示前端面板
 * 
 * 问题: AI 通过 gateway 调用 browser_navigate/click/type 等工具时，
 *       前端的 GlobalBrowserDrawer 不会自动弹出
 * 
 * 解决方案: 
 *   1. Gateway 在返回结果中注入 _show_browser: true 标记
 *   2. 前端 SSE/Socket 检测到标记后触发 openGlobalBrowser()
 * 
 * 集成方式:
 *   - 修改 tools.ts 中的 browser_* handlers
 *   - 在返回结果中添加 _show_browser: true
 *   - 前端收到结果后自动唤起浏览器面板
 */

import { getBrowserBridge } from './browser-bridge.js';

/**
 * 包装 browser_* 工具处理器，自动添加 _show_browser 标记
 */
export function wrapBrowserToolHandler(handler: Function): Function {
  return async (args: any, ctx?: any) => {
    const result = await handler(args, ctx);
    
    // 只在成功时自动显示浏览器
    if (result && result.success !== false) {
      // 标记需要自动显示浏览器面板
      result._show_browser = true;
      result._browser_action = getActionName(handler);
      
      console.log(`[BrowserAutoShow] 工具 ${getActionName(handler)} 已执行，标记自动显示浏览器`);
    }
    
    return result;
  };
}

/**
 * 获取工具函数名称
 */
function getActionName(fn: Function): string {
  return fn.name || 'unknown';
}

/**
 * 检测页面是否需要人工干预（如验证码）
 */
export function checkHumanIntervention(result: any): boolean {
  return result?.data?.captcha !== undefined || 
         result?.data?.humanIntervention === true;
}
