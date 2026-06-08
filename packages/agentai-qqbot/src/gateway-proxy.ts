/**
 * Gateway 代理 - 简化 HTTP 调用
 */
import axios, { AxiosInstance } from 'axios';

export interface QQChatReply {
  reply: string;
  provider?: string;
  usage?: { promptTokens: number; completionTokens: number; cost: number };
}

export class GatewayProxy {
  private http: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 60_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async health(): Promise<boolean> {
    try {
      const r = await this.http.get('/health', { timeout: 3000 });
      return r.data?.status === 'ok';
    } catch {
      return false;
    }
  }

  async qqMessage(userId: number | string, groupId: number | string, message: string): Promise<QQChatReply> {
    const r = await this.http.post<QQChatReply>('/v1/qq/message', { userId, groupId, message });
    return r.data;
  }
}
