/**
 * AI Rules — AI 系统规则 (文件时间线 & 版本回退)
 * ----------------------------------------------------
 * 此规则由系统自动加载到 AI 上下文,
 * 使 AI 具备以下能力:
 *   - 通过 /timeline 查看文件变更历史
 *   - 通过 /rollback <id> 回滚文件到指定版本
 *   - 自动从时间线恢复误操作的代码
 *   - 将时间线信息写入项目记忆, 持续改进
 *
 * 规则格式: 每个条目 = 一条 system prompt 指令
 */

export const TIMELINE_AI_RULES = [
  {
    id: 'tl-rule-1',
    type: 'system_rule' as const,
    title: '文件时间线管理',
    priority: 90,
    content: `你拥有文件时间线系统 (FileTimeline), 每次文件保存/创建/删除/重命名都会自动记录。

你可以:
1. 查看时间线: 调用 FileTimeline.getRecent(20) 获取最近变更
2. 回滚文件: 先查看时间线找到条目 ID, 再调用 FileTimeline.rollback(id), 最后通过 API 写入文件
3. 查询单个文件历史: FileTimeline.getByFile(path) 获取该文件所有版本
4. 搜索: FileTimeline.search(query) 按文件名/路径/摘要搜索

当以下情况时, 你应该主动使用时间线:
- 用户说 "撤销"、"回退"、"恢复"、"还原"
- 代码改错了需要回到之前版本
- 想知道最近改了哪些文件
- 确认某个文件最近的变更内容`,
  },
  {
    id: 'tl-rule-2',
    type: 'system_rule' as const,
    title: '版本回退流程',
    priority: 85,
    content: `回滚文件的正确流程:
1. 查看时间线: FileTimeline.getByFile(filePath) 找到目标版本
2. 调用回滚: FileTimeline.rollback(entryId) 获取回滚内容
3. 写入文件: 使用 API.write(path, content) 将回滚内容写入
4. 通知用户: 告知用户回滚成功, 显示回滚的摘要

注意:
- 删除操作回滚 = 恢复文件内容
- 创建操作回滚 = 删除文件 (标记为空内容)
- AI 修改标记为 ai_edit 的操作同样可回滚`,
  },
  {
    id: 'tl-rule-3',
    type: 'system_rule' as const,
    title: '自动保存项目上下文',
    priority: 80,
    content: `在以下场景, 你应该将当前对话的关键信息写入 MemoryEngine:
1. 任务完成时 (检测到 "完成"、"实现"、"修复" 等关键词)
2. 用户清空对话前
3. 页面关闭/刷新前
4. 创建了新文件或重要修改时

MemoryEngine 保存的记忆类型:
- session_memory: 会话级关键决策和结论
- project_rule: 项目规范 (AI 从代码中学习)
- code_rule: 代码规范 (AI 从代码风格中学习)
- user_custom: 用户自定义规则
- role: 角色设定记忆`,
  },
  {
    id: 'tl-rule-4',
    type: 'system_rule' as const,
    title: '避免 Git 冲突',
    priority: 75,
    content: `本系统的文件时间线 (FileTimeline) 独立于 Git, 专为 AI 操作设计:
- 每次 AI 修改文件后自动记录快照
- 支持按时间点回滚, 不需要 Git 提交
- 与 Git 共存, 互不干扰
- 可查看 AI 操作 vs 手动操作的对比`,
  },
  {
    id: 'tl-rule-5',
    type: 'system_rule' as const,
    title: '浏览器页面元素自动识别',
    priority: 90,
    content: `当你使用内嵌浏览器进行自动化操作时, 系统会自动:
1. 页面加载完成 → 自动扫描 DOM 提取可交互元素 (button/input/a/select/textarea)
2. 提取元素的 tag、text、selector、interactivity 评分
3. 将元素结构自动发送到你的上下文作为系统消息
4. 你可以在回复中直接使用 CSS Selector 操作页面元素

操作页面的方式:
- 点击: injectScript("document.querySelector('...').click()")
- 输入: injectScript("document.querySelector('...').value = '...'")
- 读取: injectScript("document.querySelector('...').textContent")
- 滚动: injectScript("window.scrollTo(0, document.body.scrollHeight)")

注意: iframe 可能有跨域限制, 无法访问时使用 Gateway 服务端扫描 (纯 HTML 解析)`,
  },
];

/**
 * 构建 AI 上下文提示字符串
 */
export function buildTimelinePrompt(recentEntries?: string): string {
  const rules = TIMELINE_AI_RULES.map(r =>
    `[规则: ${r.title}]\n${r.content}`
  ).join('\n\n');

  const recent = recentEntries
    ? `\n\n[最近文件变更]\n${recentEntries}`
    : '';

  return `${rules}${recent}`;
}
