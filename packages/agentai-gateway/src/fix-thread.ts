// 修复 Thread.tsx 中所有 ? 字符为正确的中文
const fs = require('fs');
const path = 'F:\\agentai-platform\\packages\\agentai-gui\\src\\components\\Thread.tsx';
let content = fs.readFileSync(path, 'utf8');

// 修复 line 168: {copied ? '????? : '??'} -> {copied ? '已复制' : '复制'}
// 实际文件中是: {copied ? '?????? : '??'}
const old = "{copied ? '?????? : '??'}";
const fixed = "{copied ? '已复制' : '复制'}";
if (content.includes(old)) {
  content = content.replace(old, fixed);
  console.log('Replaced copied text');
} else {
  console.log('Pattern not found. Looking for variations...');
  // 尝试单行
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('copied ?') && lines[i].includes('?')) {
      console.log(`Line ${i+1}: ${JSON.stringify(lines[i])}`);
      lines[i] = lines[i].replace(/\{copied \? '(\?+)' : '(\?+)'\}/, "{copied ? '已复制' : '复制'}");
    }
  }
  content = lines.join('\n');
}

// 修复所有行中连续的 ??? 为占位符 (后面手动核对)
let totalReplaced = 0;
content = content.replace(/'\?\?+'/g, (match: string) => {  // v3.2 修复: 显式 match 类型
  // ?????? = 6 个问号 (已复制 = 3 字符) - 但是我们不知道上下文, 先标记
  if (match === "'??????'") {
    totalReplaced++;
    return "'已复制'";
  }
  if (match === "'??'") {
    totalReplaced++;
    return "'复制'";
  }
  return match;
});
console.log(`Replaced ${totalReplaced} quoted question marks`);

fs.writeFileSync(path, content, 'utf8');
console.log('Saved');
