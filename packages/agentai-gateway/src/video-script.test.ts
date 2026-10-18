/**
 * video-script.ts — 剧本归一化 + 镜头级服装标注的纯函数单测。
 *
 * 这些函数是「剧本先审 / 服装随剧情」的地基: LLM 输出永远不可信,
 * 必须先补默认值、丢弃非法值, 再交给 GUI/分镜。这里不测 prompt 文案细节,
 * 只锁数据契约与几条不变量。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeScript,
  normalizeStoryboardCostumes,
  mergeScriptCharacters,
  buildScriptForPrompt,
  buildScriptSystemPrompt,
  buildStoryboardFromScriptSystemPrompt,
} from './video-script.js';

describe('normalizeScript — 剧本 JSON 补全与清洗', () => {
  it('保留角色/服装, 自动补 outfit id 与 defaultOutfitId', () => {
    const s = normalizeScript({
      title: ' 夜班  ',
      logline: '一名护士的最后一夜',
      characters: [{
        name: '林晚',
        description: '短发, 瘦高',
        outfits: [
          { name: '日常装', description: '白衬衫 + 牛仔裤' },
          { name: '护士服', description: '浅蓝色护士服' },
        ],
      }],
      episodes: [{ index: 1, title: '第一夜', text: '【场景】医院走廊 · 深夜' }],
    });

    expect(s.title).toBe('夜班');
    expect(s.characters).toHaveLength(1);
    expect(s.characters[0].outfits.map((o) => o.id)).toEqual(['outfit-1', 'outfit-2']);
    // 没有合法 defaultOutfitId → 回落第一套
    expect(s.characters[0].defaultOutfitId).toBe('outfit-1');
    expect(s.episodes[0].index).toBe(1);
  });

  it('非法的 defaultOutfitId 回落第一套; 合法则保留', () => {
    const bad = normalizeScript({
      characters: [{ name: 'A', outfits: [{ id: 'o1', name: '甲', description: 'x' }], defaultOutfitId: 'nope' }],
    });
    expect(bad.characters[0].defaultOutfitId).toBe('o1');

    const good = normalizeScript({
      characters: [{
        name: 'A',
        outfits: [{ id: 'o1', name: '甲', description: 'x' }, { id: 'o2', name: '乙', description: 'y' }],
        defaultOutfitId: 'o2',
      }],
    });
    expect(good.characters[0].defaultOutfitId).toBe('o2');
  });

  it('重名角色去重、空服装丢弃、重复 id 自动改名', () => {
    const s = normalizeScript({
      characters: [
        { name: 'A', outfits: [{ id: 'o1', name: '甲', description: 'x' }, { name: '乙', description: '' }, {}] },
        { name: 'A', outfits: [] },
      ],
    });
    expect(s.characters).toHaveLength(1);
    // 只有 name 或 description 的保留; 两者都空的那条被丢掉
    expect(s.characters[0].outfits).toHaveLength(2);
    expect(s.characters[0].outfits[1].id).toBe('outfit-2');
  });

  it('残缺输入不抛错 (空对象 / null / 数组)', () => {
    for (const raw of [null, undefined, {}, [], 'oops', 42]) {
      const s = normalizeScript(raw as any);
      expect(s.title).toBe('未命名剧本');
      expect(s.characters).toEqual([]);
      expect(s.episodes).toEqual([]);
    }
  });

  it('episodes 超过 20 集截断; 单集文本截断到 8000', () => {
    const s = normalizeScript({
      episodes: Array.from({ length: 30 }, (_, i) => ({ index: i + 1, text: 'x'.repeat(9000) })),
    });
    expect(s.episodes).toHaveLength(20);
    expect(s.episodes[0].text).toHaveLength(8000);
  });

  it('无 text 时回落到 summary (保证 UI 有东西可显示)', () => {
    const s = normalizeScript({ episodes: [{ index: 2, summary: '梗概内容' }] });
    expect(s.episodes[0].text).toBe('梗概内容');
    expect(s.episodes[0].index).toBe(2);
  });
});

describe('normalizeStoryboardCostumes — 镜头级服装归一化', () => {
  const script = normalizeScript({
    characters: [{
      name: '林晚',
      outfits: [
        { id: 'o1', name: '日常装', description: '白衬衫' },
        { id: 'o2', name: '正装', description: '黑西装' },
      ],
      defaultOutfitId: 'o1',
    }],
    episodes: [{ index: 1, title: 'e1', text: 't' }],
  });

  const makeSb = (costume: any) => ({
    characters: [],
    episodes: [{ index: 1, shots: [{ id: 1 }, { id: 2, costume }] }],
  });

  it('outfit id 原样保留', () => {
    const sb = normalizeStoryboardCostumes(makeSb({ 林晚: 'o2' }), script);
    expect(sb.episodes[0].shots[1].costume).toEqual({ 林晚: 'o2' });
  });

  it('服装名映射回 id (用户手改过/text 模型给的名称)', () => {
    const sb = normalizeStoryboardCostumes(makeSb({ 林晚: '正装' }), script);
    expect(sb.episodes[0].shots[1].costume).toEqual({ 林晚: 'o2' });
  });

  it('认不出的服装 / 不存在的角色 / 非字符串值 → 丢弃该条', () => {
    const sb = normalizeStoryboardCostumes(makeSb({ 林晚: '胡说', 路人: 'o1', 林晚2: 1 }), script);
    expect(sb.episodes[0].shots[1].costume).toBeUndefined();
  });

  it('空对象 / 数组 / 字符串 → 删除字段 (= 继承上一镜)', () => {
    for (const bad of [{}, [], 'o2', 3, null]) {
      const sb = normalizeStoryboardCostumes(makeSb(bad), script);
      expect(sb.episodes[0].shots[1].costume).toBeUndefined();
    }
  });

  it('没有剧本时用分镜自己的角色卡校验', () => {
    const sb = normalizeStoryboardCostumes({
      characters: [{ name: 'A', outfits: [{ id: 'x1', name: '甲', description: 'd' }] }],
      episodes: [{ shots: [{ id: 1, costume: { A: '甲' } }] }],
    }, null);
    expect(sb.episodes[0].shots[0].costume).toEqual({ A: 'x1' });
  });

  it('非法 storyboard 原样返回, 不抛错', () => {
    expect(normalizeStoryboardCostumes(null, script)).toBeNull();
    expect(normalizeStoryboardCostumes({}, script)).toEqual({});
  });
});

describe('mergeScriptCharacters — 角色表以剧本为准', () => {
  const script = normalizeScript({
    title: 't',
    characters: [
      { name: '林晚', description: '剧本外貌', outfits: [{ id: 'o1', name: '甲', description: 'd' }], defaultOutfitId: 'o1' },
    ],
  });

  it('剧本角色优先, 定妆图沿用分镜已生成的', () => {
    const merged = mergeScriptCharacters([
      { name: '林晚', description: '分镜乱写的外貌', portraitUrl: 'http://p.png', sheetUrl: 'http://s.png' },
    ], script);
    expect(merged).toHaveLength(1);
    expect(merged[0].description).toBe('剧本外貌');
    expect(merged[0].outfits).toHaveLength(1);
    expect(merged[0].portraitUrl).toBe('http://p.png');
    expect(merged[0].sheetUrl).toBe('http://s.png');
  });

  it('分镜自己多出来的角色追加在后面', () => {
    const merged = mergeScriptCharacters([{ name: '路人甲', description: 'x' }], script);
    expect(merged.map((c: any) => c.name)).toEqual(['林晚', '路人甲']);
  });

  it('没有剧本时原样返回 (向后兼容旧剧本)', () => {
    const chars = [{ name: 'A' }];
    expect(mergeScriptCharacters(chars, null)).toBe(chars);
  });
});

describe('prompt 契约', () => {
  it('buildScriptForPrompt 带剧名/角色/服装 id/集文本, 并截断', () => {
    const s = normalizeScript({
      title: '夜班',
      characters: [{ name: '林晚', description: '短发', outfits: [{ id: 'o1', name: '日常装', description: '白衬衫' }], defaultOutfitId: 'o1' }],
      episodes: [{ index: 1, title: '第一夜', text: '剧本正文' }],
    });
    const text = buildScriptForPrompt(s);
    expect(text).toContain('夜班');
    expect(text).toContain('服装[o1] 日常装');
    expect(text).toContain('首次出场默认');
    expect(text).toContain('剧本正文');
    expect(buildScriptForPrompt(s, 10)).toHaveLength(10);
  });

  it('写剧本 prompt 要求服装库与默认套, 且不写分镜术语', () => {
    const p = buildScriptSystemPrompt({ episodeCount: 3 });
    expect(p).toContain('outfits');
    expect(p).toContain('defaultOutfitId');
    expect(p).toContain('不要出现镜头号');
    expect(p).toContain('共 3 集');
  });

  it('拆分镜 prompt 明确"不得改剧情" + "未换装不要写 costume"', () => {
    const p = buildStoryboardFromScriptSystemPrompt({ shotDuration: 5, shotsPerEpisode: 6, episodeCount: 2 });
    expect(p).toContain('不得改剧名、人名、对白内容');
    expect(p).toContain('未换装的镜头不要写 costume');
    expect(p).toContain('outfit_id 只能取自该角色的服装库');
  });
});
