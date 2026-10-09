class BrowserBridge {
    io = null;
    /** 已连接的前端浏览器 socket */
    browserSockets = new Map();
    /** 待处理的命令 Promise (id → resolve/reject) */
    pending = new Map();
    /** 初始化, 注入 socket.io 实例 */
    init(io) {
        this.io = io;
        // 使用 /browser namespace
        const nsp = io.of('/browser');
        nsp.on('connection', (socket) => {
            console.log(`[browser-bridge] 前端浏览器已连接: ${socket.id}`);
            this.browserSockets.set(socket.id, socket);
            // 前端执行完命令后回传结果
            socket.on('browser:result', (result) => {
                const pending = this.pending.get(result.id);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(result.id);
                    pending.resolve(result);
                }
            });
            // 前端主动推送页面状态 (如导航完成、元素扫描结果)
            socket.on('browser:page-info', (info) => {
                // 广播给其他客户端 (如对话面板需要显示页面状态)
                socket.broadcast.emit('browser:page-info', info);
            });
            socket.on('disconnect', () => {
                console.log(`[browser-bridge] 前端浏览器已断开: ${socket.id}`);
                this.browserSockets.delete(socket.id);
                // 拒绝所有待处理命令
                for (const [id, p] of this.pending) {
                    clearTimeout(p.timer);
                    this.pending.delete(id);
                    p.reject(new Error('浏览器已断开连接'));
                }
            });
        });
    }
    /** 获取第一个已连接的浏览器 socket */
    getActiveSocket() {
        for (const socket of this.browserSockets.values()) {
            return socket;
        }
        return null;
    }
    /** 是否有浏览器连接 */
    isConnected() {
        return this.browserSockets.size > 0;
    }
    /**
     * 执行浏览器命令并等待结果
     * @param command 命令对象 (不含 id, 会自动生成)
     * @param timeoutMs 超时毫秒 (默认 30s)
     */
    execute(command, timeoutMs = 30_000) {
        const socket = this.getActiveSocket();
        if (!socket) {
            return Promise.resolve({
                id: '',
                success: false,
                error: '没有已连接的前端浏览器。请先在编辑器中打开浏览器标签页。',
            });
        }
        const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const fullCmd = { id, ...command };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`浏览器命令超时 (${timeoutMs}ms): ${command.action}`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            socket.emit('browser:command', fullCmd);
        });
    }
    /** 便捷方法: 导航 */
    async navigate(url, waitFor = 'networkidle') {
        return this.execute({ action: 'navigate', url, wait_for: waitFor }, 30_000);
    }
    /** 便捷方法: 点击 */
    async click(selector, waitMs = 1000) {
        return this.execute({ action: 'click', selector, wait_ms: waitMs }, 10_000);
    }
    /** 便捷方法: 输入文本 */
    async type(selector, text, pressEnter = false) {
        return this.execute({ action: 'type', selector, text, press_enter: pressEnter }, 10_000);
    }
    /** 便捷方法: 截图 */
    async screenshot(selector, fullPage = false) {
        return this.execute({ action: 'screenshot', selector, full_page: fullPage }, 15_000);
    }
    /** 便捷方法: 提取内容 */
    async extract(selector, extractType = 'text', fields) {
        return this.execute({ action: 'extract', selector, extract_type: extractType, fields }, 15_000);
    }
    /** 便捷方法: 扫描元素 */
    async scan() {
        return this.execute({ action: 'scan' }, 10_000);
    }
    /** 便捷方法: 滚动 */
    async scroll(direction, amount = 3) {
        return this.execute({ action: 'scroll', direction, amount }, 5_000);
    }
    /** 便捷方法: 等待元素 */
    async waitFor(selector, timeoutMs = 10_000) {
        return this.execute({ action: 'wait', selector, timeout: timeoutMs }, timeoutMs + 5_000);
    }
    /** 便捷方法: 执行 JS */
    async evaluate(code) {
        return this.execute({ action: 'evaluate', code }, 10_000);
    }
    /** 便捷方法: 提交表单 */
    async submit(selector) {
        return this.execute({ action: 'submit', selector }, 10_000);
    }
    /** 便捷方法: 文件上传 */
    async upload(selector, filePath) {
        return this.execute({ action: 'upload', selector, file_path: filePath }, 15_000);
    }
    /** 便捷方法: 标签页管理 */
    async tabs(action, tabId, url) {
        return this.execute({ action: 'tabs', tab_action: action, tab_id: tabId, url }, 10_000);
    }
    /** 便捷方法: 注入 Cookie */
    async setCookie(cookies) {
        return this.execute({ action: 'set_cookie', cookies }, 10_000);
    }
    /** 便捷方法: 等待元素出现 (MutationObserver) */
    async waitForElement(selector, timeoutMs = 10_000) {
        return this.execute({ action: 'wait_for', selector, timeout: timeoutMs }, timeoutMs + 5_000);
    }
    /** 便捷方法: 下拉框选择 */
    async select(selector, value) {
        return this.execute({ action: 'select', selector, value }, 10_000);
    }
    /** 便捷方法: 鼠标悬停 */
    async hover(selector) {
        return this.execute({ action: 'hover', selector }, 10_000);
    }
    /** 便捷方法: 按键 */
    async pressKey(key) {
        return this.execute({ action: 'press_key', key }, 5_000);
    }
    /** 便捷方法: 滚动到元素 */
    async scrollTo(selector) {
        return this.execute({ action: 'scroll_to', selector }, 10_000);
    }
    /** 便捷方法: 获取元素属性 */
    async getAttribute(selector, attribute) {
        return this.execute({ action: 'get_attribute', selector, attribute }, 10_000);
    }
    /** 便捷方法: 提取表格数据 (返回 JSON) */
    async extractTables(selector) {
        return this.execute({ action: 'extract_tables', selector }, 15_000);
    }
    /** 便捷方法: 提取卡片列表 (返回 JSON) */
    async extractCards(selector, fields) {
        return this.execute({ action: 'extract_cards', selector, fields }, 15_000);
    }
}
/** 单例 */
let _instance = null;
export function getBrowserBridge() {
    if (!_instance)
        _instance = new BrowserBridge();
    return _instance;
}
