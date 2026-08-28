// 测试 linkifyFilePaths 正则
const extPattern = '(?:tsx?|jsx?|py|rs|go|java|css|scss|sass|less|html?|json|ya?ml|toml|md|txt|csv|sql|sh|bash|zsh|vue|svelte|swift|kt|dart|c|cpp|cs|php|rb|lua|xlsx?|docx?|pptx?|pdf|zip|rar|7z|tar|gz|bz2|mp3|mp4|avi|mov|webm|wav|flac|ogg|bmp|jpe?g|png|gif|svg|webp|ico|psd|fig)';

// Test 1: Windows path
const winRe = new RegExp('([A-Za-z]:\\\\[^\\s<>|"\'*|?\\n\\r]+\\.' + extPattern + ')', 'gi');
const t1 = '已创建文件 F:\\agentai-platform\\test.ts 完成';
console.log('Test1 win:', t1.replace(winRe, (m) => `[LINK:${m}]`));

// Test 2: Unix path
const unixRe = new RegExp('(/(?:home|Users|opt|var|tmp|root|etc)/[^\\s<>|"\'*|?\\n\\r]+\\.' + extPattern + ')', 'gi');
const t2 = 'saved to /home/user/file.py ok';
console.log('Test2 unix:', t2.replace(unixRe, (m) => `[LINK:${m}]`));

// Test 3: keyword + relative path
const kwRe = new RegExp('(已生成|已创建|已保存|文件[:：]?|路径[:：]?|生成[:：]?|创建[:：]?|保存[:：]?)\\s*[`"\']?([^\\s`"\'\\n\\r<>]+\\.' + extPattern + ')[`"\']?', 'gi');
const t3 = '已生成 report.xlsx 和 文件: config.ts';
console.log('Test3 keyword:', t3.replace(kwRe, (_m, p, f) => `${p} [LINK:${f}]`));

// Test 4: backtick filename
const bkRe = new RegExp('`([^`\\n\\r<>]+\\.' + extPattern + ')`', 'gi');
const t4 = '修改了 `index.ts` 和 `style.css`';
console.log('Test4 backtick:', t4.replace(bkRe, (_m, f) => `[LINK:${f}]`));

console.log('All tests done');
