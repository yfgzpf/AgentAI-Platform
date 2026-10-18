/**
 * 剧本 (Script) → 分镜 (Storyboard) 的数据契约与归一化 — 纯函数, 无 IO。
 *
 * 背景 (2026-10-17):
 *   原 /v1/video/storyboard 一次调用直接产出整部分镜, 没有"可读剧本供用户审核"的
 *   中间态; 角色服装只在 `description` 字符串里写一次, 全剧一套, 随不了剧情。
 *
 * 现在拆成两步:
 *   1) POST /v1/video/script      → 可读剧本 (逐集文本 + 角色服装库), 用户审核/编辑
 *   2) POST /v1/video/storyboard  → 拿着已确认剧本只做镜头拆分, 服装按镜头标注换装
 *
 * 四条设计不变量 (与 GUI 侧 storyboard-costume 测试同源):
 *   - 服装真相在镜头级: 角色卡持服装库, 镜头只记**显式换装**;
 *   - 未标注 = 继承: 没写服装的镜头沿用本集向前最近一次显式值, 首镜回落默认套;
 *   - 换装必须显式: 只有真的换了才写 costume, 连续性才是默认;
 *   - 认不出就丢弃: LLM 编造的 outfit_id 直接丢掉, 绝不猜 (GUI 可手改)。
 */

export interface Outfit {
  /** 稳定 id (建议 o1/o2), 分镜的 costume 用它引用 */
  id: string;
  name: string;
  description: string;
  /** 该套服装的参考图 (可选, 按需生成, 不自动产生成本) */
  imageUrl?: string;
}

export interface ScriptCharacter {
  name: string;
  /** 只写外貌 (年龄/性别/发型/体型/标志特征), 不写具体服装 */
  description: string;
  refImageIndex?: number;
  outfits: Outfit[];
  /** 该角色**首次出场**时穿的服装 id */
  defaultOutfitId: string;
}

export interface ScriptEpisode {
  index: number;
  title: string;
  summary: string;
  /** 可直接阅读/编辑的剧本全文 (场景 + 动作 + 对白) */
  text: string;
}

export interface ScriptDraft {
  title: string;
  logline: string;
  characters: ScriptCharacter[];
  episodes: ScriptEpisode[];
}

const MAX_EPISODES = 20;
const MAX_CHARACTERS = 24;
const MAX_OUTFITS = 8;
const MAX_EPISODE_TEXT = 8000;

const str = (v: any): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: any): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** 从英文名字生成 ASCII id; 全被过滤掉时用 fallback */
function slugId(input: string, fallback: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || fallback;
}

/**
 * 把 LLM 返回的剧本 JSON 归一化。
 * 不抛错 —— 残缺字段补默认值, 非法条目丢弃, 保证前端永远能渲染。
 */
export function normalizeScript(raw: any): ScriptDraft {
  const src = raw && typeof raw === 'object' ? raw : {};

  const seenNames = new Set<string>();
  const characters: ScriptCharacter[] = [];
  for (const rc of (Array.isArray(src.characters) ? src.characters : []).slice(0, MAX_CHARACTERS)) {
    const name = str(rc?.name);
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);

    const outfits: Outfit[] = [];
    const usedIds = new Set<string>();
    for (const [i, ro] of (Array.isArray(rc?.outfits) ? rc.outfits : []).slice(0, MAX_OUTFITS).entries()) {
      const oName = str(ro?.name);
      const description = str(ro?.description);
      // 名字和描述都空 → 这条服装没有信息量, 丢掉
      if (!oName && !description) continue;
      let id = str(ro?.id) || slugId(oName, `outfit-${i + 1}`);
      while (usedIds.has(id)) id = `${id}-${i + 1}`;
      usedIds.add(id);
      const outfit: Outfit = { id, name: oName || `造型${i + 1}`, description };
      const imageUrl = str(ro?.imageUrl);
      if (imageUrl) outfit.imageUrl = imageUrl;
      outfits.push(outfit);
    }

    const wantedDefault = str(rc?.defaultOutfitId);
    const defaultOutfitId = outfits.some((o) => o.id === wantedDefault)
      ? wantedDefault
      : (outfits[0]?.id || '');

    const character: ScriptCharacter = {
      name,
      description: str(rc?.description),
      outfits,
      defaultOutfitId,
    };
    const refIndex = num(rc?.refImageIndex);
    if (refIndex !== undefined) character.refImageIndex = refIndex;
    characters.push(character);
  }

  const episodes: ScriptEpisode[] = [];
  for (const [i, re] of (Array.isArray(src.episodes) ? src.episodes : []).slice(0, MAX_EPISODES).entries()) {
    const text = str(re?.text) || str(re?.script) || str(re?.summary);
    episodes.push({
      index: num(re?.index) ?? i + 1,
      title: str(re?.title) || `第${i + 1}集`,
      summary: str(re?.summary),
      text: text.slice(0, MAX_EPISODE_TEXT),
    });
  }

  return {
    title: str(src.title) || '未命名剧本',
    logline: str(src.logline),
    characters,
    episodes,
  };
}

/** characterName → (id|服装名小写 → outfitId) */
function buildOutfitLookup(chars: any[]): Map<string, Map<string, string>> {
  const lookup = new Map<string, Map<string, string>>();
  for (const c of chars || []) {
    const name = str(c?.name);
    if (!name) continue;
    const m = new Map<string, string>();
    for (const o of Array.isArray(c?.outfits) ? c.outfits : []) {
      const id = str(o?.id);
      if (!id) continue;
      m.set(id, id);
      const on = str(o?.name).toLowerCase();
      if (on) m.set(on, id);
    }
    lookup.set(name, m);
  }
  return lookup;
}

/**
 * 归一化分镜里的镜头级服装标注 (原地修改并返回)。
 *
 * - 服装库来源: 剧本角色表优先, 没有剧本时退回分镜自己的角色卡;
 * - 值可以是 outfit id 或服装名, 统一映射回 id;
 * - 认不出来 / 角色不存在 / 空对象 → 删除该字段 (= 继承上一镜)。
 */
export function normalizeStoryboardCostumes(
  storyboard: any,
  script: ScriptDraft | null | undefined,
): any {
  if (!storyboard || !Array.isArray(storyboard.episodes)) return storyboard;
  const lookup = buildOutfitLookup(
    (script?.characters?.length ? script.characters : storyboard.characters) || [],
  );

  for (const ep of storyboard.episodes) {
    for (const shot of Array.isArray(ep?.shots) ? ep.shots : []) {
      const raw = shot?.costume;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        delete shot?.costume;
        continue;
      }
      const next: Record<string, string> = {};
      for (const [charName, value] of Object.entries(raw as Record<string, unknown>)) {
        const outfits = lookup.get(charName);
        if (!outfits || typeof value !== 'string') continue;
        const key = value.trim();
        const id = outfits.get(key) || outfits.get(key.toLowerCase());
        if (id) next[charName] = id;
      }
      if (Object.keys(next).length > 0) shot.costume = next;
      else delete shot.costume;
    }
  }
  return storyboard;
}

/**
 * 以剧本角色表为准合并分镜角色卡:
 * 服装库/外貌以剧本为准, 定妆图/九宫格沿用分镜里已生成的; 剧本没有的角色追加在后面。
 */
export function mergeScriptCharacters(
  storyboardChars: any[] | undefined,
  script: ScriptDraft | null | undefined,
): any[] {
  const existing = Array.isArray(storyboardChars) ? storyboardChars : [];
  if (!script?.characters?.length) return existing;

  const byName = new Map<string, any>();
  for (const c of existing) {
    const name = str(c?.name);
    if (name) byName.set(name, c);
  }

  const merged: any[] = script.characters.map((sc) => {
    const old = byName.get(sc.name);
    const out: any = { ...sc };
    for (const key of ['portraitUrl', 'sheetUrl'] as const) {
      if (old && typeof old[key] === 'string' && old[key]) out[key] = old[key];
    }
    return out;
  });

  for (const c of existing) {
    const name = str(c?.name);
    if (name && !script.characters.some((sc) => sc.name === name)) merged.push(c);
  }
  return merged;
}

/** 把已确认剧本压成一段文本塞进分镜 prompt (截断防上下文暴涨) */
export function buildScriptForPrompt(script: ScriptDraft, maxChars = 6000): string {
  const lines: string[] = [`剧名: ${script.title}`];
  if (script.logline) lines.push(`一句话梗概: ${script.logline}`);
  if (script.characters.length) {
    lines.push('角色表 (服装 id 供分镜引用):');
    for (const c of script.characters) {
      lines.push(`- ${c.name}: ${c.description}`);
      for (const o of c.outfits) {
        lines.push(`  服装[${o.id}] ${o.name}: ${o.description}${o.id === c.defaultOutfitId ? ' (首次出场默认)' : ''}`);
      }
    }
  }
  for (const ep of script.episodes) {
    lines.push(`\n第${ep.index}集 ${ep.title}`);
    if (ep.text) lines.push(ep.text);
    else if (ep.summary) lines.push(ep.summary);
  }
  return lines.join('\n').slice(0, maxChars);
}

/** 「写剧本」的 system prompt */
export function buildScriptSystemPrompt(opts: { episodeCount: number }): string {
  const { episodeCount } = opts;
  return `你是一位专业的中文短剧编剧。根据用户的创意写出一份**可以直接阅读和修改的剧本**。

【只写剧本, 不写分镜】
- 不要出现镜头号、景别、运镜、时长这类拍摄术语; 这些由下一步"拆分镜"完成
- 每一集是一段可读的剧本文本: 场景标题(地点+时间) → 动作描述 → 对白

【剧本铁律】
1. 视觉优先: 写具体的可拍摄动作与画面 (如"把杯子重重放下"), 不写"内心感到悲伤"
2. 对白精炼: 每句台词不超过15字, 用 "角色名: 台词" 格式
3. 环境具体: 每场写明地点、时间、光线方向、关键道具
4. 每集有起承转合: 冲突推进 → 转折 → 钩子; 上一集结尾自然接下一集
5. 共 ${episodeCount} 集, 每集 400-700 字

【角色服装规则 — 必须产出服装库】
- 每个角色给 2-4 套服装, 字段: id(用 o1/o2/o3), name(简短名称), description(颜色+款式+材质等可拍摄细节)
- defaultOutfitId = 该角色**第一次出场**时穿的那套
- 只在剧情合理时新增服装: 换场(如从公司回家)、换日、身份/职业变化、重要事件(婚礼/葬礼/受伤)
- 同一场连续戏内不得换装; 不要为每个场景都换衣服
- description 只写人物外貌(年龄/性别/发型/体型/标志特征), **不要**把服装写进 description

【输出JSON格式 — 只输出JSON, 不要markdown标记】
{
  "title": "剧名",
  "logline": "一句话梗概",
  "characters": [
    {
      "name": "角色名",
      "description": "外貌描述(不含服装)",
      "refImageIndex": 0,
      "outfits": [
        { "id": "o1", "name": "日常装", "description": "深蓝牛仔裤 + 白色宽松衬衫" },
        { "id": "o2", "name": "正装", "description": "黑色修身西装 + 白衬衫" }
      ],
      "defaultOutfitId": "o1"
    }
  ],
  "episodes": [
    {
      "index": 1,
      "title": "本集标题",
      "summary": "本集一句话梗概",
      "text": "【场景】公司会议室 · 白天 · 落地窗透进冷光\\n【动作】林晚把文件夹摔在桌上...\\n林晚: \\"这个方案重做。\\"\\n..."
    }
  ]
}`;
}

/** 「拿已确认剧本拆分镜」的 system prompt */
export function buildStoryboardFromScriptSystemPrompt(opts: {
  shotDuration: number;
  shotsPerEpisode: number;
  episodeCount: number;
}): string {
  const { shotDuration, shotsPerEpisode, episodeCount } = opts;
  return `你是一位专业分镜师。下面是一份**用户已经确认过的剧本**。你的唯一任务是把每一集拆成镜头。

【绝对不许改动剧本】
- 不得改剧名、人名、对白内容、剧情走向、结局
- 不得增删角色; characters 数组必须与剧本角色表**逐字一致**(含 outfits 与 defaultOutfitId)
- 对白原样搬进镜头 dialogue 字段, 不要改写措辞

【只做镜头语言】
- 每镜补: type(WS/MS/CU/ECU) / camera_motion / mood / prompt / dialogue / monologue
- prompt 必须可直接发给视频模型: 80-120字中文, 含环境+角色动作+光线氛围+镜头运动
- 角色动作必须具体可拍; 情绪用表情/肢体表达, 内心戏写进 monologue
- 每镜 ${shotDuration} 秒, 每集 ${shotsPerEpisode} 镜, 共 ${episodeCount} 集

【服装 — 只在换装的那一镜标注】
- 每个镜头的 characters 数组列出出场角色名
- 服装默认沿用上一镜; **未换装的镜头不要写 costume 字段**
- 只有某角色本镜服装与上一镜不同时, 才写 "costume": { "角色名": "outfit_id" }
- outfit_id 只能取自该角色的服装库; 集内第一镜不写 costume (自动用 defaultOutfitId)
- 剧本里没写换装的地方, 不要自己发明换装

【场景卡】
- 每集给一个 scene: { name, description }。一集有多场景时取**主场景**(戏份最多), 其余场景写进对应镜头的 prompt

【输出JSON格式 — 只输出JSON, 不要markdown标记】
{
  "title": "剧名",
  "characters": [
    { "name": "角色名", "description": "外貌", "refImageIndex": 0,
      "outfits": [{ "id": "o1", "name": "日常装", "description": "..." }],
      "defaultOutfitId": "o1" }
  ],
  "episodes": [
    {
      "index": 1,
      "title": "本集标题",
      "scene": { "name": "场景名", "description": "场景环境描述" },
      "shots": [
        {
          "id": 1,
          "type": "MS",
          "duration": "${shotDuration}",
          "camera_motion": "slow push in",
          "mood": "tense",
          "prompt": "80-120字可直接生成视频的描述",
          "characters": ["角色名1"],
          "dialogue": "角色名: \\"台词原样搬过来\\"",
          "monologue": "",
          "costume": { "角色名1": "o2" }
        }
      ]
    }
  ]
}`;
}
