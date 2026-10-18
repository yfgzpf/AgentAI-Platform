// 临时探针 6: 定位底部状态栏里裸露的 "unknown" 到底是哪个元素渲染的
// 注意: 传给 page.evaluate 的函数会被 esbuild 包上 __name() 导致浏览器端 ReferenceError,
// 所以这里用字符串表达式 (与 browser-engine 注入脚本同样的道理)。
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const skip = page.getByText('跳过设置', { exact: false }).first();
if (await skip.count().catch(() => 0)) { await skip.click({ timeout: 2000 }).catch(() => {}); }
await page.waitForTimeout(2000);

const DIAG = `(() => {
  var out = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var txt = (el.textContent || '').trim();
    if (txt === 'unknown' && el.children.length === 0) {
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      out.push({
        tag: el.tagName, cls: el.className, title: el.title,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        color: cs.color, bg: cs.backgroundColor,
        parentHTML: (el.parentElement && el.parentElement.outerHTML || '').slice(0, 300)
      });
    }
  }
  var bottom = [];
  for (var j = 0; j < all.length; j++) {
    var e2 = all[j];
    var r2 = e2.getBoundingClientRect();
    if (r2.y > window.innerHeight - 36 && r2.height > 0 && r2.width > 0) {
      var t2 = (e2.textContent || '').trim();
      if (t2 && e2.children.length === 0) bottom.push(Math.round(r2.x) + '@' + t2.slice(0, 24));
    }
  }
  return { unknownNodes: out, bottomLeaves: bottom };
})()`;

const info: any = await page.evaluate(DIAG);
console.log('--- unknown 节点 ---');
console.log(JSON.stringify(info.unknownNodes, null, 1).slice(0, 2000));
console.log('--- 底部叶子文本 (x@text) ---');
console.log(info.bottomLeaves.join(' | '));

await b.close();
process.exit(0);
