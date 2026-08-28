const fs = require('fs');
const p = 'f:/agentai-platform/packages/agentai-gui/src/store/modelStore.ts';
let c = fs.readFileSync(p, 'utf8');
const before = (c.match(/provider: 'factory'/g) || []).length;
c = c.split("provider: 'factory'").join("provider: 'alrc'");
fs.writeFileSync(p, c, 'utf8');
console.log('Replaced', before, 'occurrences of provider: factory -> alrc');
