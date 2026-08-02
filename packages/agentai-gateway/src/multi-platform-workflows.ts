/**
 * 多平台内容发布自动化 - 工作流示例
 * 
 * 本文档展示如何使用 AI + 浏览器自动化实现多平台内容发布
 */

// ═══════════════════════════════════════════════════════════
// 场景1: 公众号文章自动发布流程
// ═══════════════════════════════════════════════════════════

/**
 * 用户指令: "帮我写一篇文章并发布到微信公众号"
 * 
 * AI 执行流程:
 * 1. adapt_content_for_platform({originalContent: "...", targetPlatform: "wechat"})
 *    → 适配公众号风格
 * 2. publish_wechat_article({
 *      title: "标题",
 *      content: "正文Markdown",
 *      author: "作者名",
 *      username: "公众号账号",
 *      password: "公众号密码"
 *    })
 *    → 浏览器自动登录 → 填写内容 → 发布
 */

// ═══════════════════════════════════════════════════════════
// 场景2: 抖音视频自动发布流程
// ═══════════════════════════════════════════════════════════

/**
 * 用户指令: "发布这个视频到抖音"
 * 
 * AI 执行流程:
 * 1. publish_douyin_video({
 *      title: "视频标题",
 *      description: "视频描述",
 *      videoPath: "/path/to/video.mp4",
 *      tags: ["#搞笑", "#段子"],
 *      username: "抖音账号",
 *      password: "抖音密码"
 *    })
 *    → 浏览器自动登录创作者中心 → 上传视频 → 填写信息 → 发布
 */

// ═══════════════════════════════════════════════════════════
// 场景3: 小红书笔记自动发布流程
// ═══════════════════════════════════════════════════════════

/**
 * 用户指令: "帮我把这些图片发到小红书"
 * 
 * AI 执行流程:
 * 1. publish_xiaohongshu_note({
 *      title: "笔记标题",
 *      content: "笔记正文",
 *      images: ["/path/to/img1.jpg", "/path/to/img2.jpg"],
 *      tags: ["#分享", "#生活"],
 *      category: "生活",
 *      username: "小红书账号",
 *      password: "小红书密码"
 *    })
 *    → 浏览器自动登录创作者中心 → 上传图片 → 填写信息 → 发布
 */

// ═══════════════════════════════════════════════════════════
// 场景4: 多平台一键分发
// ═══════════════════════════════════════════════════════════

/**
 * 用户指令: "把这篇文章同时发到公众号和小红书"
 * 
 * AI 执行流程:
 * 1. multi_platform_publish({
 *      content: "文章内容",
 *      platforms: [
 *        { platform: "wechat", title: "公众号标题" },
 *        { platform: "xiaohongshu", title: "小红书标题" }
 *      ],
 *      username: "主账号",
 *      password: "主密码"
 *    })
 *    → 逐个平台登录并发布
 */

// ═══════════════════════════════════════════════════════════
// 安全建议
// ═══════════════════════════════════════════════════════════

/**
 * 1. 密码存储:
 *    - 建议使用环境变量存储敏感信息
 *    - 或使用加密的凭证管理器
 *    - 避免在日志中记录密码
 * 
 * 2. 会话保持:
 *    - 首次登录后，浏览器会保存 Cookie
 *    - 后续发布无需重复登录
 *    - 可配置 Cookie 有效期
 * 
 * 3. 频率限制:
 *    - 各平台有发布频率限制
 *    - 建议添加间隔时间（如每平台间隔5分钟）
 *    - 避免触发平台风控
 * 
 * 4. 内容审核:
 *    - 发布前建议先保存草稿
 *    - 人工确认后再正式发布
 *    - 可使用 preview_edit 工具预览内容
 */

// ═══════════════════════════════════════════════════════════
// 浏览器自动化集成说明
// ═══════════════════════════════════════════════════════════

/**
 * 多平台发布工具依赖浏览器自动化能力:
 * 
 * 1. browser_navigate - 导航到平台后台
 * 2. browser_type - 填写表单
 * 3. browser_click - 点击按钮
 * 4. browser_upload - 上传文件
 * 5. browser_screenshot - 截图验证
 * 
 * 使用流程:
 * - 首次使用: 提供账号密码，AI 自动登录
 * - 后续使用: 浏览器已登录，直接发布
 * - 如遇验证码: AI 会提示用户手动处理
 * 
 * CSS Selector 参考:
 * - 微信公众号: #article-title, #editor-container, #publish-btn
 * - 抖音创作者中心: #upload-btn, #title-input, #publish-btn
 * - 小红书: #note-title, #note-content-editor, #publish-note-btn
 */

export const WORKFLOW_EXAMPLES = {
  wechat_publish: `
用户: "帮我写一篇关于AI的文章并发布到公众号"
AI:
  1. adapt_content_for_platform({
       originalContent: "AI技术正在改变世界...",
       targetPlatform: "wechat"
     })
  2. publish_wechat_article({
       title: "AI技术如何改变我们的未来",
       content: "<h1>AI技术如何改变我们的未来</h1>...",
       author: "科技观察者",
       username: "user@example.com",
       password: "password123"
     })
  `,
  
  douyin_publish: `
用户: "发布这个视频到抖音"
AI:
  1. publish_douyin_video({
       title: "超有趣的AI演示",
       description: "看看AI能做什么！",
       videoPath: "/Users/user/videos/ai-demo.mp4",
       tags: ["#AI", "#科技", "#趣味"],
       username: "douyin_user",
       password: "password123"
     })
  `,
  
  xiaohongshu_publish: `
用户: "把这些美食照片发到小红书"
AI:
  1. publish_xiaohongshu_note({
       title: "超好吃的家常菜做法",
       content: "今天教大家做一道简单的家常菜...",
       images: [
         "/Users/user/photos/dish1.jpg",
         "/Users/user/photos/dish2.jpg"
       ],
       tags: ["#美食", "#家常菜", "#做饭"],
       category: "美食",
       username: "xhs_user",
       password: "password123"
     })
  `,
};
