/**
 * 角色服装随剧情 — 镜头级服装 + 继承解析 + 提示词注入 (2026-10-17)
 * ========================================================================
 * 设计契约 (与 gateway `video-script.ts` 同源):
 *   1. 服装库在角色卡; 镜头只记录**显式换装**。
 *   2. 未标注 = 继承本集上一镜; 集内首镜回落默认套; 跨集不继承。
 *   3. 提交给视频模型的 prompt 必须带解析后的服装。
 *
 * 这里测的是**纯函数行为** (import 真实实现), 不是源码文本 ——
 * 因为"改了第 3 镜, 第 4/5 镜要自动跟着变"正是继承链的行为, 文本断言证明不了。
 * 另附少量源码契约 (两段式 UI 存在 / 保存不丢 script), 防以后被顺手删掉。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSubmitPrompt, resolveShotCostumes } from './components/StoryboardPanel';
import type { Shot, Storyboard } from './components/StoryboardPanel';

const ROOT = resolve(__dirname, '..', '..', '..');
const panelSrc = readFileSync(
  join(ROOT, 'packages/agentai-gui/src/components/StoryboardPanel.tsx'),
  'utf-8',
);
const stripComments = (code: string) => code
  .split('\n')
  .filter(line => {
    const t = line.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('*/');
  })
  .join('\n');
const code = stripComments(panelSrc);

const shot = (id: number, over: Partial<Shot> = {}): Shot => ({
  id, type: 'MS', duration: '5', camera_motion: '', mood: '',
  prompt: `prompt-${id}`, characters: ['林'], dialogue: '', ...over,
});

/** 2 集 3 镜: 首镜默认 → 第2镜换礼服 → 第3镜继承; 第2集从默认套重新起 */
const sb = (): Storyboard => ({
  title: '测试剧',
  characters: [
    {
      name: '林', description: '短发女人', defaultOutfitId: 'o1',
      outfits: [
        { id: 'o1', name: '常服', description: '灰色高领毛衣 + 牛仔裤' },
        { id: 'o2', name: '礼服', description: '红色丝绒长裙' },
      ],
    },
    {
      name: '周', description: '高个男人', defaultOutfitId: 'c1',
      outfits: [{ id: 'c1', name: '工装', description: '蓝色工装外套' }],
    },
  ],
  episodes: [
    {
      index: 1, title: '第一集', shots: [
        shot(1),
        shot(2, { costume: { 林: 'o2' } }),
        shot(3, { characters: ['林', '周'] }),
      ],
    },
    {
      index: 2, title: '第二集', shots: [shot(1, { characters: ['林'] })],
    },
  ],
});

describe('resolveShotCostumes: 未标注 = 继承', () => {
  it('集内首镜 → 默认套 (changed=false)', () => {
    const r = resolveShotCostumes(sb(), 0, 0);
    expect(r['林']).toMatchObject({ outfitId: 'o1', name: '常服', description: '灰色高领毛衣 + 牛仔裤', changed: false });
  });

  it('显式标注的那一镜 → 那套服装, 且标记 changed', () => {
    const r = resolveShotCostumes(sb(), 0, 1);
    expect(r['林'].outfitId).toBe('o2');
    expect(r['林'].changed).toBe(true);
  });

  it('后续镜头自动继承上一镜的显式值 (changed=false)', () => {
    const r = resolveShotCostumes(sb(), 0, 2);
    expect(r['林'].outfitId).toBe('o2');
    expect(r['林'].changed).toBe(false);
    // 另一个角色从自己的默认套起
    expect(r['周']).toMatchObject({ outfitId: 'c1', changed: false });
  });

  it('跨集隔离 — 第二集首镜回到默认套, 不继承上一集', () => {
    const r = resolveShotCostumes(sb(), 1, 0);
    expect(r['林'].outfitId).toBe('o1');
    expect(r['林'].changed).toBe(false);
  });

  it('★ 改前面某镜的服装, 后面继承的镜头跟着变 (联动是继承链算出来的)', () => {
    const s = sb();
    delete s.episodes[0].shots[1].costume; // 第2镜不再换装
    expect(resolveShotCostumes(s, 0, 2)['林'].outfitId).toBe('o1');
  });

  it('服装被删导致标注失效 → 回落默认套, 不产出不存在的 id', () => {
    const s = sb();
    s.characters[0].outfits = s.characters[0].outfits!.filter(o => o.id !== 'o2');
    const r = resolveShotCostumes(s, 0, 1);
    expect(r['林'].outfitId).toBe('o1');
  });

  it('没有服装库 (旧剧本) → 空对象, 行为与改动前一致', () => {
    const s = sb();
    s.characters = s.characters.map(c => ({ name: c.name, description: c.description }));
    expect(resolveShotCostumes(s, 0, 0)).toEqual({});
  });

  it('越界 / 空数据不抛错', () => {
    expect(resolveShotCostumes(null, 0, 0)).toEqual({});
    expect(resolveShotCostumes(sb(), 99, 0)).toEqual({});
    expect(resolveShotCostumes(sb(), 0, 99)).toEqual({});
  });
});

describe('buildSubmitPrompt: 服装必须进提交文本', () => {
  it('带解析结果 → 每个角色一条 [Costume], 换装镜带标记', () => {
    const s = sb();
    const target = { ...s.episodes[0].shots[1], costumeResolved: resolveShotCostumes(s, 0, 1) };
    const prompt = buildSubmitPrompt(target);
    expect(prompt).toContain('[Costume] 林: 红色丝绒长裙 (changed at this shot)');
  });

  it('继承镜不标 changed', () => {
    const s = sb();
    const target = { ...s.episodes[0].shots[2], costumeResolved: resolveShotCostumes(s, 0, 2) };
    const prompt = buildSubmitPrompt(target);
    expect(prompt).toContain('[Costume] 林: 红色丝绒长裙');
    expect(prompt).not.toContain('changed at this shot');
    expect(prompt).toContain('[Costume] 周: 蓝色工装外套');
  });

  it('无 costumeResolved (旧剧本 / 未解析) → 不产生 [Costume] 段', () => {
    expect(buildSubmitPrompt(shot(1))).not.toContain('[Costume]');
  });

  it('服装描述为空 → 跳过该角色, 不产生空标签', () => {
    const target = {
      ...shot(1),
      costumeResolved: { 林: { outfitId: 'o1', name: '空', description: '' } },
    };
    expect(buildSubmitPrompt(target)).not.toContain('[Costume]');
  });
});

describe('两段式源码契约: 剧本审核门', () => {
  it('★ 生成剧本走 /v1/video/script, 不再一步出分镜', () => {
    expect(code).toContain('/v1/video/script');
    expect(code).toMatch(/const generateScript = async/);
    expect(code).toMatch(/refine:\s*\{\s*instruction/);
  });

  it('★ 确认剧本才调 /v1/video/storyboard, 且把 script 带上', () => {
    expect(code).toMatch(/const confirmScript = async/);
    // confirmScript 里必须 `script,` 与 storyboard 端点同现
    const body = code.slice(code.indexOf('const confirmScript'), code.indexOf('const generatePortrait'));
    expect(body).toContain('/v1/video/storyboard');
    expect(body).toMatch(/^\s*script,\s*$/m);
  });

  it('★ 没有分镜时强制停在剧本审核 (审核门不可绕过)', () => {
    expect(code).toContain("storyboard?.script && storyboard.episodes.length === 0 ? 'script' : (sbView || 'shots')");
  });

  it('★ 自动保存必须带上 script (溢出兜底也要), 否则服装库重载即丢', () => {
    expect(code).toMatch(/script:\s*storyboard\.script/);
    expect(code).toMatch(/costumeResolved:\s*undefined/);
  });

  it('镜卡服装行 + 解析型提交都在', () => {
    expect(code).toMatch(/const updateShotCostume = /);
    expect(code).toMatch(/const withResolvedCostume = /);
    expect(code).toContain('👕 服装');
  });
});
