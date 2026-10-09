// 活跃隧道表 (key = tunnel id)
const _tunnels = new Map();
/** 端口安全检查 */
function validatePort(port) {
    if (!Number.isInteger(port))
        return { ok: false, reason: '端口必须是整数' };
    if (port < 1024)
        return { ok: false, reason: '拒绝系统端口 (<1024)' };
    if (port > 65535)
        return { ok: false, reason: '端口超出范围 (>65535)' };
    // 拒绝敏感端口
    const SENSITIVE = new Set([22, 23, 3389, 445, 135, 139]);
    if (SENSITIVE.has(port))
        return { ok: false, reason: `拒绝敏感端口 ${port}` };
    return { ok: true };
}
/**
 * 通过 localtunnel.me HTTPS API 创建隧道
 * 协议: 客户端 → wss://tunnel.myservicess.com → 转发到本地 port
 *
 * 此处采用轻量实现: 直接用 localtunnel npm 包 (动态导入, 缺失则提示安装)
 */
async function createTunnel(port, subdomain) {
    // 优先尝试动态加载 localtunnel 包
    try {
        // 使用 require 替代 import 避免类型检查错误
        const mod = require('localtunnel');
        const lt = mod.default || mod;
        const opts = { port, host: 'https://tunnel.myservicess.com', subdomain };
        const tunnel = await lt(opts);
        // 监听 close 事件
        tunnel.on('close', () => {
            for (const [id, rec] of _tunnels) {
                if (rec.url === tunnel.url) {
                    _tunnels.delete(id);
                    break;
                }
            }
        });
        return { url: tunnel.url, process: tunnel };
    }
    catch (e) {
        // localtunnel 包未安装 → 提示安装
        if (e.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package/.test(e.message)) {
            throw new Error('localtunnel 包未安装, 请让 AI 调用 npm_install({package:"localtunnel", type:"npm"}) 安装后再试');
        }
        throw e;
    }
}
/** 主入口: share_port 工具处理器 */
export async function sharePort(args) {
    const { action } = args;
    // ====== 创建隧道 ======
    if (action === 'create') {
        const port = Number(args.port);
        const v = validatePort(port);
        if (!v.ok)
            return { success: false, output: `❌ 端口校验失败: ${v.reason}` };
        // 避免重复为同一端口建隧道
        for (const rec of _tunnels.values()) {
            if (rec.port === port) {
                return {
                    success: true,
                    output: `✅ 端口 ${port} 已存在公网隧道 (复用)\nURL: ${rec.url}\nID: ${rec.id}\n关闭命令: share_port({action:"close", tunnel_id:"${rec.id}"})`,
                    data: { url: rec.url, id: rec.id, port, reused: true },
                };
            }
        }
        try {
            const { url, process } = await createTunnel(port, args.subdomain);
            const id = `tun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
            const record = {
                id, port, subdomain: args.subdomain,
                url, pid: process?.pid || 0, createdAt: Date.now(), process,
            };
            _tunnels.set(id, record);
            return {
                success: true,
                output: [
                    `🌐 公网隧道已创建!`,
                    ``,
                    `本地端口: ${port}`,
                    `公网 URL: ${url}`,
                    `隧道 ID: ${id}`,
                    ``,
                    `现在可以将此 URL 分享给他人:`,
                    `  - 任何人访问 ${url} 都会被转发到你的 localhost:${port}`,
                    `  - 适合演示、调试、Webhook 测试、远程协助`,
                    ``,
                    `关闭隧道: share_port({action:"close", tunnel_id:"${id}"})`,
                    `查看所有隧道: share_port({action:"list"})`,
                ].join('\n'),
                data: { url, id, port, createdAt: record.createdAt },
            };
        }
        catch (e) {
            return { success: false, output: `❌ 创建隧道失败: ${e.message}` };
        }
    }
    // ====== 列出隧道 ======
    if (action === 'list') {
        if (_tunnels.size === 0) {
            return { success: true, output: '📭 当前无活跃隧道。创建: share_port({action:"create", port:3000})' };
        }
        const lines = [`📡 活跃隧道 (${_tunnels.size})`, ``];
        for (const rec of _tunnels.values()) {
            const age = Math.floor((Date.now() - rec.createdAt) / 1000);
            lines.push(`• ID: ${rec.id}`);
            lines.push(`  URL: ${rec.url}`);
            lines.push(`  端口: ${rec.port} | 已运行: ${age}s`);
            lines.push(``);
        }
        return { success: true, output: lines.join('\n'), data: { tunnels: Array.from(_tunnels.values()).map(r => ({ id: r.id, url: r.url, port: r.port })) } };
    }
    // ====== 关闭隧道 ======
    if (action === 'close') {
        if (!args.tunnel_id)
            return { success: false, output: '❌ 缺少 tunnel_id 参数' };
        const rec = _tunnels.get(args.tunnel_id);
        if (!rec)
            return { success: false, output: `❌ 隧道 ${args.tunnel_id} 不存在` };
        try {
            rec.process?.kill('SIGTERM');
        }
        catch { /* ignore */ }
        _tunnels.delete(args.tunnel_id);
        return { success: true, output: `✅ 隧道已关闭\nID: ${rec.id}\nURL: ${rec.url} (已失效)` };
    }
    // ====== 关闭所有隧道 ======
    if (action === 'close_all') {
        const count = _tunnels.size;
        if (count === 0)
            return { success: true, output: '📭 无活跃隧道' };
        for (const rec of _tunnels.values()) {
            try {
                rec.process?.kill('SIGTERM');
            }
            catch { /* ignore */ }
        }
        _tunnels.clear();
        return { success: true, output: `✅ 已关闭 ${count} 个隧道` };
    }
    return { success: false, output: `未知 action: ${action}` };
}
/** 获取当前隧道数 (供系统状态查询用) */
export function getActiveTunnelCount() {
    return _tunnels.size;
}
