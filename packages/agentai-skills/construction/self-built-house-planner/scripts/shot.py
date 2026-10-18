# -*- coding: utf-8 -*-
"""
SVG → PNG 高清出图（Headless Chrome 方案）
==========================================

为什么用 Chrome headless 而不是 cairosvg / rsvg：
  中文字体渲染。cairosvg 依赖 fontconfig，Windows 上中文常掉字或变方框；
  Chrome 直接用系统字体（微软雅黑 / 思源黑体），与设计稿一致。

关键做法：
  1. 窗口尺寸 = SVG 的 viewBox 尺寸 × scale，**不能随手写 1400×1300**，
     否则图形只占画布左上角（本技能 v1.0 踩过此坑）。
  2. --force-device-scale-factor=2 出 2 倍图，插入 Word 后仍清晰。
  3. body 边距必须清零，否则截图多出白边；零边距之后无需再裁切。
  4. SVG 必须自带 <rect> 白底，不能依赖 --default-background-color
     （透明区域在 Word 里会变黑）。

用法：
    python shot.py                     # 转换 figs/*.svg 全部
    python shot.py c2_f1 c3_f2         # 只转指定图
    python shot.py --dir figs --scale 3
"""

import argparse
import os
import re
import shutil
import subprocess
import sys

# 常见 Chrome / Edge 路径，按顺序探测
CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]


def find_browser(explicit=None):
    if explicit:
        if os.path.exists(explicit):
            return explicit
        raise FileNotFoundError('指定的浏览器不存在: %s' % explicit)
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    w = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chrome')
    if w:
        return w
    raise FileNotFoundError(
        '未找到 Chrome / Edge。请用 --browser 指定可执行文件路径。')


def svg_size(path):
    """从 SVG 的 viewBox 读取画布尺寸。"""
    with open(path, encoding='utf-8') as f:
        s = f.read()
    m = re.search(r'viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"', s)
    if not m:
        raise ValueError('%s 缺少 viewBox，无法确定画布尺寸' % path)
    return int(float(m.group(1))), int(float(m.group(2)))


def shot(name, figdir='figs', browser=None, scale=2, wrap=False, margin=0):
    svg = os.path.join(figdir, name + '.svg')
    if not os.path.exists(svg):
        raise FileNotFoundError(svg)
    w, h = svg_size(svg)
    png = os.path.abspath(os.path.join(figdir, name + '.png'))
    browser = browser or find_browser()

    url = 'file:///' + os.path.abspath(svg).replace('\\', '/')
    if wrap or margin:
        # 需要留边距时，包一层 HTML，body 边距清零再由 margin 控制
        html = ('<!DOCTYPE html><html><head><meta charset="utf-8">'
                '<style>html,body{margin:0;padding:0;background:#fff}'
                'svg{display:block;margin:%dpx}</style></head><body>'
                % margin) + open(svg, encoding='utf-8').read() + '</body></html>'
        tmp = os.path.abspath(os.path.join(figdir, '_shot_%s.html' % name))
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(html)
        url = 'file:///' + tmp.replace('\\', '/')
        w, h = w + 2 * margin, h + 2 * margin

    cmd = [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars',
           '--force-device-scale-factor=%d' % scale,
           '--default-background-color=FFFFFFFF',
           '--screenshot=' + png,
           '--window-size=%d,%d' % (w, h), url]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if wrap or margin:
        try:
            os.remove(url.replace('file:///', '').replace('/', os.sep))
        except OSError:
            pass
    return png, w, h


def main():
    ap = argparse.ArgumentParser(description='SVG → PNG 批量出图')
    ap.add_argument('names', nargs='*', help='图名（不含扩展名），留空则转全部')
    ap.add_argument('--dir', default='figs', help='图件目录')
    ap.add_argument('--browser', default=None, help='Chrome/Edge 可执行文件路径')
    ap.add_argument('--scale', type=int, default=2, help='输出倍率，默认 2')
    args = ap.parse_args()

    names = args.names or sorted(
        f[:-4] for f in os.listdir(args.dir) if f.endswith('.svg'))
    if not names:
        print('no svg found in', args.dir)
        return
    b = find_browser(args.browser)
    for n in names:
        png, w, h = shot(n, args.dir, b, args.scale)
        print('%-16s %4dx%-4d -> %s' % (n, w, h, os.path.basename(png)))


if __name__ == '__main__':
    main()
