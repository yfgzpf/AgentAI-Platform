#!/usr/bin/env node
/**
 * 缓存命中率 Benchmark
 * ----------------------------------------------------------------
 * 验证 DeepSeekCacheStrategy 的 fingerprint 是否稳定
 * 学自: Reasonix bench-fold-cache-live.mjs
 * 
 * 用法: npx tsx tools/bench-cache-hit.ts
 */

import { DeepSeekCacheStrategy } from '../src/deepseek-cache-strategy.js';
import { ToolRegistry } from '../src/tool-registry.js';

// 模拟工具列表
const mockTools = [
  { name: 'read_file', description: '读取文件' },
  { name: 'write_file', description: '写入文件' },
  { name: 'list_directory', description: '列出目录' },
  { name: 'run_command', description: '运行命令' },
  { name: 'web_search', description: '网页搜索' },
  { name: 'multi_edit', description: '多文件编辑' },
  { name: 'recognize_blueprint', description: '识别图纸' },
  { name: 'generate_quotation', description: '生成报价' },
];

const SYSTEM_PROMPT = `你是一个AI编程助手。请使用工具完成用户任务。
规则: 保持简洁、直接执行、不要空谈。`;

console.log('=== DeepSeekCacheStrategy Benchmark ===\n');

// 1. 初始创建
const cache = new DeepSeekCacheStrategy({
  system: SYSTEM_PROMPT,
  toolDefs: mockTools,
  skillContents: [],
});

const fp1 = cache.getFingerprint();
console.log(`Initial fingerprint: ${fp1}`);
console.log(`Prefix tokens: ~${cache.getCacheStats().prefixTokens}`);

// 2. 添加工具 (应该触发 cache miss)
const changed = cache.addTool({ name: 'parse_dxf', description: '解析DXF图纸' });
console.log(`\nAdd 'parse_dxf' tool → changed: ${changed}`);
const fp2 = cache.getFingerprint();
console.log(`New fingerprint:    ${fp2}`);
console.log(`Cache hit (fp1==fp2): ${fp1 === fp2 ? 'YES ✅' : 'NO ❌ (expected)'}`);

// 3. 重复添加同一工具 (不应触发变更)
const changed2 = cache.addTool({ name: 'parse_dxf', description: '解析DXF图纸' });
console.log(`\nRe-add 'parse_dxf' → changed: ${changed2} (should be false)`);
const fp3 = cache.getFingerprint();
console.log(`Fingerprint unchanged: ${fp2 === fp3 ? 'YES ✅' : 'NO ❌'}`);

// 4. 添加技能内容 (不应触发 cache miss — skills 不在 immutable prefix 中)
cache.addSkillContent('decoration-quote', '装修报价技能内容...');
const fp4 = cache.getFingerprint();
console.log(`\nAdd skill content → fingerprint changed: ${fp3 !== fp4 ? 'YES ❌' : 'NO ✅'} (should be NO)`);

// 5. 替换 system prompt (应该触发 cache miss)
cache.replaceSystem('新的系统提示词。');
const fp5 = cache.getFingerprint();
console.log(`\nReplace system → fingerprint changed: ${fp4 !== fp5 ? 'YES ✅' : 'NO ❌'}`);

// 6. 统计
console.log(`\n=== Final Stats ===`);
console.log(`Tools: ${cache.getCacheStats().toolsCached}`);
console.log(`Skills: ${cache.getCacheStats().skillsCount}`);
console.log(`Prefix tokens: ${cache.getCacheStats().prefixTokens}`);

// 7. 模拟真实场景: 多次调用不变 → 缓存命中
console.log(`\n=== Simulated Session ===`);
const sessionFingerprints: string[] = [];
for (let i = 0; i < 10; i++) {
  sessionFingerprints.push(cache.getFingerprint());
}
const allSame = sessionFingerprints.every(f => f === sessionFingerprints[0]);
console.log(`10 turns, same fingerprint: ${allSame ? 'YES ✅ (99%+ cache hit expected)' : 'NO ❌'}`);
if (!allSame) {
  console.log(`  Fingerprints: ${sessionFingerprints.map(f=>f?.slice(0,8)).join(', ')}`);
}
