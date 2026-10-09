export interface QQChatReply {
    reply: string;
    provider?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        cost: number;
    };
}
export declare class GatewayProxy {
    private http;
    private baseUrl;
    constructor(baseUrl: string);
    health(): Promise<boolean>;
    qqMessage(userId: number | string, groupId: number | string, message: string): Promise<QQChatReply>;
}
