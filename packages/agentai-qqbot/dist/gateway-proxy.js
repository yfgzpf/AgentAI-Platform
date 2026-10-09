/**
 * Gateway 代理 - 简化 HTTP 调用
 */
import axios from 'axios';
export class GatewayProxy {
    http;
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.http = axios.create({
            baseURL: this.baseUrl,
            timeout: 60_000,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    async health() {
        try {
            const r = await this.http.get('/health', { timeout: 3000 });
            return r.data?.status === 'ok';
        }
        catch {
            return false;
        }
    }
    async qqMessage(userId, groupId, message) {
        const r = await this.http.post('/v1/qq/message', { userId, groupId, message });
        return r.data;
    }
}
//# sourceMappingURL=gateway-proxy.js.map