#!/usr/bin/env node
// @ts-nocheck
/**
 * Trae 技能迁移脚本
 * ----------------------------------------------------
 * 将 Trae IDE 的技能目录迁移到 AgentAI Platform
 *
 * 用法:
 *   npx tsx packages/agentai-gateway/src/skills/migrate.ts <trae-skills-dir>
 *
 * 示例:
 *   npx tsx packages/agentai-gateway/src/skills/migrate.ts ~/.trae/skills
 *
 * Trae 技能格式:
 *   <skill-name>/
 *     SKILL.md       # 技能描述
 *     *.py / *.sh    # 脚本文件
 *
 * 转换后:
 *   ~/.agentai/skills/<category>/<skill-name>/
 *     SKILL.md       # 标准化格式
 *     main.py        # 脚本 (如果有)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

const TARGET_DIR = path.join(os.homedir(), '.agentai', 'skills');

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function detectCategory(name: string, description: string): string {
  const text = `${name} ${description}`.toLowerCase();
  if (/test|spec|jest|mocha|vitest/.test(text)) return 'testing';
  if (/deploy|docker|k8s|kubernetes|ci|cd/.test(text)) return 'deployment';
  if (/lint|format|prettier|eslint/.test(text)) return 'code-quality';
  if (/review|audit|security|scan/.test(text)) return 'security';
  if (/docs|readme|changelog/.test(text)) return 'documentation';
  if (/git|branch|commit|pr/.test(text)) return 'git';
  if (/data|sql|database|query/.test(text)) return 'data';
  return 'general';
}

function detectTools(content: string): string[] {
  const tools: string[] = [];
  const toolPatterns: Array<[string, RegExp]> = [
    ['read_file', /read.*file|open.*file|cat/i],
    ['write_file', /write.*file|create.*file|save/i],
    ['edit_file', /edit.*file|modify.*file|replace/i],
    ['bash', /run.*command|execute.*script|shell/i],
    ['list_directory', /list.*dir|ls /i],
    ['search_files', /search.*file|find.*file/i],
    ['web_search', /search.*web|google/i],
    ['web_fetch', /fetch.*url|download/i],
    ['glob', /glob|pattern.*match/i],
    ['search_content', /grep|search.*content/i],
    ['get_symbols', /symbol|outline/i],
    ['directory_tree', /tree|recursive.*list/i],
  ];

  for (const [tool, re] of toolPatterns) {
    if (re.test(content)) {
      tools.push(tool);
    }
  }

  return tools.length > 0 ? tools : ['read_file', 'list_directory'];
}

function detectTriggers(name: string, description: string): string[] {
  const triggers: string[] = [name];
  if (description) {
    // 提取描述中的关键词
    const words = description.split(/[\s,，。？！;；：:]+/).filter(w => w.length >= 2);
    triggers.push(...words.slice(0, 5));
  }
  return [...new Set(triggers)];
}

async function migrateSkill(sourceDir: string, name: string): Promise<boolean> {
  const sourcePath = path.join(sourceDir, name);
  if (!fs.statSync(sourcePath).isDirectory()) return false;

  console.log(`\n📦 迁移技能: ${name}`);

  // 读取 SKILL.md
  const skillMdPath = path.join(sourcePath, 'SKILL.md');
  let description = '';
  let rawContent = '';

  if (fs.existsSync(skillMdPath)) {
    rawContent = fs.readFileSync(skillMdPath, 'utf-8');
    // 提取描述 (跳过 frontmatter)
    const bodyMatch = rawContent.match(/---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)/);
    description = bodyMatch ? bodyMatch[1].trim().slice(0, 200) : rawContent.slice(0, 200);
  }

  // 检测脚本
  let hasScript = false;
  let scriptType: 'python' | 'undefined' = 'undefined';
  for (const f of fs.readdirSync(sourcePath)) {
    if (f.endsWith('.py') || f === 'main.py') {
      hasScript = true;
      scriptType = 'python';
      break;
    }
    if (f.endsWith('.sh') || f === 'main.sh') {
      hasScript = true;
      scriptType = 'python'; // 用 python 类别
      break;
    }
  }

  // 自动检测
  const category = detectCategory(name, description);
  const tools = detectTools(rawContent);
  const triggers = detectTriggers(name, description);

  console.log(`   分类: ${category}`);
  console.log(`   工具: ${tools.join(', ')}`);
  console.log(`   触发: ${triggers.join(', ')}`);

  // 创建目标目录
  const targetPath = path.join(TARGET_DIR, category, name);
  fs.mkdirSync(targetPath, { recursive: true });

  // 生成标准化 SKILL.md
  const standardizedMd = `---
name: ${name}
description: ${description}
category: ${category}
tools:
${tools.map(t => `  - ${t}`).join('\n')}
triggers:
${triggers.map(t => `  - "${t}"`).join('\n')}
---

${description}

${hasScript ? `\n## 脚本\n\n本技能包含可执行脚本 (${scriptType})` : ''}
`;

  fs.writeFileSync(path.join(targetPath, 'SKILL.md'), standardizedMd, 'utf-8');

  // 复制脚本文件
  for (const f of fs.readdirSync(sourcePath)) {
    if (f === 'SKILL.md') continue;
    const srcFile = path.join(sourcePath, f);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, path.join(targetPath, f));
      console.log(`   复制: ${f}`);
    }
  }

  console.log(`   ✅ 迁移完成: ${targetPath}`);
  return true;
}

async function main() {
  const sourceDir = process.argv[2];

  if (!sourceDir) {
    console.log('🔧 Trae 技能迁移工具');
    console.log('');
    console.log('用法:');
    console.log('  npx tsx packages/agentai-gateway/src/skills/migrate.ts <trae-skills-dir>');
    console.log('');
    console.log('示例:');
    console.log('  npx tsx packages/agentai-gateway/src/skills/migrate.ts ~/.trae/skills');
    process.exit(0);
  }

  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ 目录不存在: ${sourceDir}`);
    process.exit(1);
  }

  console.log(`🔍 扫描技能目录: ${sourceDir}`);
  const entries = fs.readdirSync(sourceDir).filter(e =>
    fs.statSync(path.join(sourceDir, e)).isDirectory(),
  );
  console.log(`   发现 ${entries.length} 个技能`);

  if (entries.length === 0) {
    console.log('   没有找到技能，退出');
    process.exit(0);
  }

  const mode = await prompt('\n迁移模式: [a]全部 / [s]选择 (默认 a): ');
  let selected: string[];

  if (mode.toLowerCase() === 's') {
    console.log('\n可用技能:');
    entries.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    const input = await prompt('\n选择编号 (逗号分隔): ');
    const indices = input.split(',').map(s => parseInt(s.trim()) - 1);
    selected = indices.map(i => entries[i]).filter(Boolean);
  } else {
    selected = entries;
  }

  console.log(`\n🚀 开始迁移 ${selected.length} 个技能...`);
  let success = 0;
  let failed = 0;

  for (const name of selected) {
    try {
      const ok = await migrateSkill(sourceDir, name);
      if (ok) success++;
      else failed++;
    } catch (e: any) {
      console.error(`   ❌ 失败: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n📊 迁移完成: 成功 ${success}, 失败 ${failed}`);
  console.log(`   技能目录: ${TARGET_DIR}`);
}

main().catch(e => {
  console.error('❌ 迁移失败:', e);
  process.exit(1);
});
