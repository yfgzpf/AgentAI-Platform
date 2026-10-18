/**
 * 自定义视频模型 (BYOK) 的本地存储 — 单一真源
 * ====================================================================
 * 2026-10-13 新增。此前这段逻辑内联在 VideoGen.tsx 里 (getCustomModels /
 * saveCustomModels / CustomModel 接口), 于是产生了一个很隐蔽的断链:
 *
 *   VideoGen.tsx 与 StoryboardPanel.tsx **各自**提交视频任务 ——
 *     前者走 videoTaskManager.submitTask, 后者自己实现了 submitVideoTask + pollVideo
 *   BYOK 打通时只改了前者。后者构造的 body 里依然没有 apiKey
 *   ⇒ 用户在「剧本分镜」模式下选自定义模型, Key 依旧不下发, 而单次生成模式正常。
 *   症状: 同一个自定义模型, 两个模式下行为不一致, 极难自查。
 *
 * 抽出来不是为了"代码整洁", 是为了让**两条提交路径共用同一份凭证定义**,
 * 下次再加一条路径时至少 import 同一个函数就会发现要带 byok。
 */

export interface CustomVideoModel {
    id: string;
    name: string;
    apiKey: string;
    baseUrl: string;
}

/** localStorage key — 保持与历史一致, 否则老用户已存的模型会"消失" */
export const CUSTOM_VIDEO_MODELS_KEY = 'agentai-custom-video-models';

/** 上游缺省端点 (与后端 routes/video.ts parseByokCredentials 的默认值一致) */
export const DEFAULT_CUSTOM_VIDEO_BASE_URL = 'https://apihub.agnes-ai.cn/v1';

export function getCustomModels(): CustomVideoModel[] {
    try {
        const raw = localStorage.getItem(CUSTOM_VIDEO_MODELS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

export function saveCustomModels(models: CustomVideoModel[]): void {
    localStorage.setItem(CUSTOM_VIDEO_MODELS_KEY, JSON.stringify(models));
}

/**
 * 取出某个模型 id 对应的凭证 (提交/轮询时随请求下发)。
 *
 * @param modelValue VideoGen/StoryboardPanel 里选中值, 形如 `custom:custom-123`
 * @returns 自定义模型 → 其凭证; 非自定义模型 → null (调用方据此走服务端 env)
 *
 * 注意: 返回 null 与返回"空 apiKey"是两种语义, 后者代表用户在 UI 里填了模型
 * 却没填 Key —— 两种都该由调用方按"非自定义"处理, 但日志上要能区分, 故此处
 * 只在凭证完整时返回, 避免下游误以为"用户提供了有效凭证"。
 */
export function resolveByokCredential(modelValue?: string): { apiKey: string; baseUrl?: string } | null {
    if (!modelValue || !modelValue.startsWith('custom:')) return null;
    const id = modelValue.slice('custom:'.length);
    const m = getCustomModels().find(x => x.id === id);
    if (!m?.apiKey?.trim()) return null;
    return {
        apiKey: m.apiKey.trim(),
        baseUrl: m.baseUrl?.trim() || undefined,
    };
}