declare module './qq-bot-client.js' {
  import { EventEmitter } from 'events';

  export interface QQBotEventAuthor { id: string; username: string; bot: boolean; }
  export interface QQBotEventContentBlock { type: number; text?: string; url?: string; }
  export interface QQBotEvent { id: string; type: string; content: string | QQBotEventContentBlock[]; author: QQBotEventAuthor; timestamp: string; guild_id?: string; channel_id?: string; }
  export interface QQBotClientConfig { appId: string; appSecret: string; wsToken?: string; baseUrl?: string; tokenUrl?: string; }
  export interface QQBotToken { access_token: string; expires_in: number; obtained_at: number; expires_at: number; }
  export class QQBotClient extends EventEmitter {
    constructor(config: QQBotClientConfig);
    init(): Promise<void>;
    getToken(): Promise<string>;
    connectWebSocket(onEvent?: (event: QQBotEvent) => void): Promise<void>;
    sendMessage(content: string, guildId?: string, channelId?: string): Promise<boolean>;
    sendC2Message(openid: string, content: string, msgId?: string): Promise<boolean>;
    destroy(): void;
    on(event: string, handler: (...args: any[]) => void): void;
  }
}
