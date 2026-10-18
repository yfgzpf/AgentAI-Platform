/**
 * src-rules 解析器自检
 * 跑法 (gateway 目录): node ./node_modules/tsx/dist/cli.mjs scripts/src-rules-check.mjs
 */
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'srcrules-'));
process.env.AGENTAI_HOME = path.join(TMP, 'home');
const mod = await import('../src/src-rules.ts');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

// ── 真实场景 1: 用户截图里的页面形态（授权 + 禁止 + 奖励）──
const PAGE = `
漏洞奖励计划

SRC 简介
vala 安全应急响应中心致力于提升产品质量与安全。

一、授权测试范围
以下域名属于授权范围:
*.bestpay.com.cn
api.bestpay.com.cn
admin.bestpay.com.cn
www.bestpay.cn

二、禁止测试
禁止测试以下内容:
支付网关内部系统
第三方托管的 oms.bestpay.cn
任何社会工程学测试
DoS/CC 攻击
禁止对 www.tycredit.com 进行任何形式的测试

三、奖励标准
高危 5000-20000 元
中危 1000-5000 元
低危 100-1000 元
`;

console.log('\n═══ ① 整页粘贴 → 结构化规则 ═══');
const r = mod.parseSrcPage(PAGE, 'vala');
console.log(`  解析结果: 授权=${r.inScope.length} 禁止=${r.outOfScope.length} 行为禁令=${r.forbiddenActions.length} 待确认=${r.uncertain.length}`);
console.log(`  置信度: ${r.confidence}\n`);
r.inScope.forEach(h => console.log(`   [IN ] ${h}`));
r.outOfScope.forEach(h => console.log(`   [OUT] ${h}`));
r.forbiddenActions.forEach(h => console.log(`   [NO ] ${h}`));

check('识别出授权目标', r.inScope.length >= 3, JSON.stringify(r.inScope));
check('保留通配符 *.bestpay.com.cn', r.inScope.includes('*.bestpay.com.cn'), JSON.stringify(r.inScope));
check('识别具体子域 api.bestpay.com.cn', r.inScope.includes('api.bestpay.com.cn'));
check('**没有 punycode 垃圾**', !r.inScope.some(h => h.includes('xn--')), JSON.stringify(r.inScope.filter(h => h.includes('xn--'))));
check('**没有 dos 这种噪声**', !r.inScope.includes('dos'), JSON.stringify(r.inScope));
check('**没有中文乱码域名**', !r.inScope.some(h => /[^\x00-\x7F]/.test(h)));
check('**识别禁止域名** oms.bestpay.cn', r.outOfScope.some(h => h.includes('oms.bestpay.cn')), JSON.stringify(r.outOfScope));
check('**识别禁止域名** www.tycredit.com', r.outOfScope.some(h => h.includes('tycredit.com')), JSON.stringify(r.outOfScope));
check('**识别行为禁令** DoS/CC', r.forbiddenActions.some(a => /dos|cc/i.test(a)), JSON.stringify(r.forbiddenActions));
check('**识别行为禁令** 社会工程', r.forbiddenActions.some(a => /社会工程/.test(a)), JSON.stringify(r.forbiddenActions));
check('抽出奖励等级', r.rewards.length >= 2, JSON.stringify(r.rewards));
check('置信度合理(>=0.6)', r.confidence >= 0.6, String(r.confidence));

console.log('\n═══ ② 安全: deny 优先（禁止项不能同时被授权）═══');
{
  const danger = `
授权测试范围:
*.tycredit.com
admin.bestpay.cn

禁止测试:
*.tycredit.com
`;
  const d = mod.parseSrcPage(danger);
  check('禁止的通配域被从授权列表剔除', !d.inScope.includes('*.tycredit.com'), JSON.stringify(d.inScope));
  check('未禁止的仍保留', d.inScope.includes('admin.bestpay.cn'), JSON.stringify(d.inScope));
  check('记录了剔除提示', d.notes.some(n => /剔除|移除/.test(n)), JSON.stringify(d.notes));
}

console.log('\n═══ ③ 无授权标题 → 保守处理（不自动授权）═══');
{
  const vague = `我们是一家金融科技公司, 欢迎反馈漏洞。
网站是 example.com
还有 www.example.org
`;
  const v = mod.parseSrcPage(vague);
  check('未凭空授权', v.inScope.length === 0, JSON.stringify(v.inScope));
  check('列入待确认', v.uncertain.length >= 2, JSON.stringify(v.uncertain));
  check('置信度低', v.confidence < 0.6, String(v.confidence));
  check('提示需人工确认', v.notes.some(n => /待确认|人工/.test(n)), JSON.stringify(v.notes));
}

console.log('\n═══ ④ 英文站形态 ═══');
{
  const en = `
Bug Bounty Program

In Scope:
*.example.com
api.example.com

Out of scope:
Third-party assets
Social engineering
Denial of service testing
github.com
`;
  const e = mod.parseSrcPage(en, 'English Program');
  check('识别 *.example.com', e.inScope.includes('*.example.com'), JSON.stringify(e.inScope));
  check('禁止项 github.com 被识别', e.outOfScope.includes('github.com'), JSON.stringify(e.outOfScope));
  check('禁止行为 DoS', e.forbiddenActions.some(a => /denial of service/i.test(a)), JSON.stringify(e.forbiddenActions));
  check('禁止行为 social engineering', e.forbiddenActions.some(a => /social engineering/i.test(a)));
}

console.log('\n═══ ⑤ 落盘 + 读取 + 确认 ═══');
{
  const ws = path.join(TMP, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const f = mod.saveSrcRules(ws, r, false);
  check('文件已落盘', fs.existsSync(f));
  const back = mod.readSrcRules(ws);
  check('可读回', back !== null);
  check('初始为未确认', back?.confirmed === false);
  mod.confirmSrcRules(ws);
  check('确认后状态更新', mod.readSrcRules(ws)?.confirmed === true);

  const ai = mod.renderSrcRulesForAi(mod.readSrcRules(ws));
  check('AI 摘要含授权清单', ai.includes('bestpay.com.cn'), ai.slice(0, 100));
  check('AI 摘要含禁止项', ai.includes('禁止'));
  check('AI 摘要明确"不要再问"', /不要.*确认|已授权/.test(ai), ai.slice(-300));
  console.log('\n─── 投喂 AI 的实际内容 ───');
  console.log(ai);
  console.log('─── 结束 ───\n');
}

console.log('\n═══ ⑥ 空输入 / 垃圾输入 ═══');
{
  check('空输入不崩', mod.parseSrcPage('').inScope.length === 0);
  check('纯符号不崩', mod.parseSrcPage('!!!@@@###$$$%%%').inScope.length === 0);
  check('超长文本不崩', mod.parseSrcPage('x'.repeat(50000) + ' a.example.com ').uncertain.length >= 0);
}

// ─────────────────────────────────────────────────────────────
// ⑦ 对抗性反例（2026-10-16 三个真事故的回归锁）
// ─────────────────────────────────────────────────────────────
console.log('\n═══ ⑦ 对抗性反例（状态机误判回归） ═══');
{
  // 事故 A: 英文站 "Third-party assets" 含弱授权词 'assets', 曾把 deny 区翻回 allow
  //        → 后果: Out of scope 段的禁止域名与行为禁令整段失效（= 越权打标）
  const en = mod.parseSrcPage(`
In Scope:
*.example.com
api.example.com

Out of scope:
Third-party assets
Social engineering
Denial of service testing
github.com

In Scope (additional, newly added):
*.newasset.example.com
`);
  check('事故A: 禁止域名 github.com 进 outOfScope', en.outOfScope.includes('github.com'), JSON.stringify(en.outOfScope));
  check('事故A: Social engineering 进禁令', en.forbiddenActions.some(a => /social engineering/i.test(a)), JSON.stringify(en.forbiddenActions));
  check('事故A: Denial of service 进禁令', en.forbiddenActions.some(a => /denial of service/i.test(a)), JSON.stringify(en.forbiddenActions));
  check('事故A: 弱词未把 deny 翻回 allow（github 不在授权表）', !en.inScope.includes('github.com'), JSON.stringify(en.inScope));
  check('事故A: deny 之后的新 allow 段仍被识别', en.inScope.includes('*.newasset.example.com'), JSON.stringify(en.inScope));

  // 事故 B: 中文否定插入 —— 「以下域名不在**授权**范围：」
  //        DENY_HINTS 里只有 '不在范围', 中间插了「授权」导致只命中强 allow 词
  //        → 后果: 状态 deny→allow, 两个明确禁止域名被收进 inScope（最高危误判）
  const cn = mod.parseSrcPage(`
一、授权测试范围
以下域名属于授权范围：
*.bestpay.com.cn
admin.bestpay.com.cn

二、禁止测试
禁止 DoS/CC 攻击
不得进行任何形式的社会工程学测试
以下域名不在授权范围：
oms.bestpay.cn
第三方：www.tycredit.com
`);
  check('事故B: oms.bestpay.cn 进 outOfScope', cn.outOfScope.includes('oms.bestpay.cn'), JSON.stringify(cn.outOfScope));
  check('事故B: www.tycredit.com 进 outOfScope', cn.outOfScope.includes('www.tycredit.com'), JSON.stringify(cn.outOfScope));
  check('事故B: 两个禁止域名均不在授权表', !cn.inScope.some(h => /oms\.bestpay|tycredit/.test(h)), JSON.stringify(cn.inScope));
  check('事故B: 授权域名仍正确保留', cn.inScope.includes('*.bestpay.com.cn') && cn.inScope.includes('admin.bestpay.com.cn'), JSON.stringify(cn.inScope));
  check('事故B: 中文禁令识别', cn.forbiddenActions.length >= 2, JSON.stringify(cn.forbiddenActions));

  // 事故 C: REWARD_HINTS 里 'low' 是 'allow'/'below' 的子串,
  //        includes 判定会让授权标题行被抢成奖励区（并把状态从 deny 带走）
  const low = mod.parseSrcPage(`
Below is the list of allowed targets:
*.a.example.com
Out of scope:
github.com
`);
  check('事故C: "Below"/"allowed" 未被当成奖励线索', !low.rewards.some(r => /below is the list/i.test(r)), JSON.stringify(low.rewards));
  check('事故C: github.com 仍在禁止表', low.outOfScope.includes('github.com'), JSON.stringify(low.outOfScope));

  // 保守性: 无标题纯列表绝不自动授权
  const bare = mod.parseSrcPage('example.com\ntest.example.org');
  check('无标题纯列表不自动授权', bare.inScope.length === 0 && bare.uncertain.length === 2, JSON.stringify(bare));
  check('无标题纯列表置信度低', bare.confidence <= 0.4, String(bare.confidence));
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log(`\n═══ 结果: ${pass} 通过 / ${fail} 失败 ═══\n`);
process.exit(fail > 0 ? 1 : 0);