# -*- coding: utf-8 -*-
"""
建筑规划图绘制库（Architectural Plan SVG Kit）
==============================================

设计原则（这是本技能出图规范性的根本，请勿破坏）：
  1. **单一数据源**：轴网 AX / AY 只定义一次，所有图层（房间、门窗、楼梯、
     尺寸、标高、房间表）都从同一套参数出图 → 墙体不可能对不齐。
  2. **坐标即米**：所有几何以米为单位，通过 Mapper 映射到像素；
     禁止在业务代码里手写像素坐标。
  3. **中文用单引号**：SVG style 属性里 font-family 必须用单引号，
     双引号会破坏 XML（本技能 v1.0 踩过此坑）。
  4. **画布尺寸用变量拼接**：viewBox 不能写 '...%d...' % 格式化，
     因为 width="100%" 里的 % 会被吃成格式化占位符。

基本用法：
    from draw_lib import Sheet
    sh = Sheet(760, 880, '图 2　一层平面图', '会客接待层｜建筑面积 97.65 ㎡')
    M = sh.mapper(AX, AY, scale=46, ox=100, oy=118)
    sh.grid(M)
    sh.room(M, 0.30, 3.44, 3.80, 6.54, '客厅', '21.70 ㎡')
    sh.stair(M, 0.30, 0.34, 3.80, 3.44)
    sh.dim_h(M, AX[0], AX[-1], AY[0], off=64, label='10.50')
    sh.notes([...], y=870)
    sh.save('c2_f1')
"""

import math
import os

# ----------------------------------------------------------------------
# 配色与字号（浅色工程图风格，打印友好）
# ----------------------------------------------------------------------
THEME = {
    'line': '#2A2A28', 'gray': '#7A7870',
    'grayf': '#EFEDE7', 'grayd': '#CFCBC0',
    'blue': '#1B5E9E', 'bluef': '#E4EEF7',
    'amber': '#8A5A0B', 'amberf': '#F7EDD8',
    'green': '#1E6B45', 'greenf': '#E0EFE6',
    'water': '#1D6A96', 'waterf': '#DDEBF3',
    'red': '#A62B1E', 'wood': '#7A5C2E', 'stone': '#8C8677',
    'violet': '#5B3F86', 'violetf': '#EFEAF7',
    'plot': '#FDFCF8',
}

# ⚠️ font-family 必须用单引号！
_FONT = ("font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;"
         "font-size:%spx")

FONT = {
    'nm':  _FONT % '11',
    'nmb': _FONT % '11.5' + ';font-weight:500',
    'sb':  _FONT % '9.5',
    'ax':  _FONT % '8.5',
    'ttl': _FONT % '13' + ';font-weight:500',
    'sub': _FONT % '10',
}


def esc(t):
    return (str(t).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


# ----------------------------------------------------------------------
# 坐标映射器
# ----------------------------------------------------------------------
class Mapper:
    """把「米」映射到「像素」。图纸 +Y 向下，+X 向右。"""

    def __init__(self, AX, AY, scale, ox, oy):
        self.AX, self.AY = list(AX), list(AY)
        self.scale, self.ox, self.oy = scale, ox, oy

    def sx(self, v):
        return self.ox + (v - self.AX[0]) * self.scale

    def sy(self, v):
        return self.oy + (v - self.AY[0]) * self.scale

    # 尺寸（米）→ 像素
    def mw(self, v):
        return v * self.scale

    @property
    def width(self):
        return (self.AX[-1] - self.AX[0]) * self.scale

    @property
    def depth(self):
        return (self.AY[-1] - self.AY[0]) * self.scale

    def box(self, x0, y0, x1, y1):
        """返回像素矩形 (px, py, pw, ph)。"""
        return (self.sx(x0), self.sy(y0), self.mw(x1 - x0), self.mw(y1 - y0))


# ----------------------------------------------------------------------
# 图幅
# ----------------------------------------------------------------------
class Sheet:
    def __init__(self, w, h, title='', sub='', theme=None):
        self.w, self.h = int(w), int(h)
        self.C = dict(THEME)
        if theme:
            self.C.update(theme)
        # ⚠️ 画布尺寸必须用字符串拼接，不能用 % 格式化（见模块 docstring）
        self.s = ['<svg xmlns="http://www.w3.org/2000/svg" width="100%" '
                  'viewBox="0 0 ' + str(self.w) + ' ' + str(self.h) + '">',
                  '<rect width="' + str(self.w) + '" height="' + str(self.h)
                  + '" fill="' + self.C['plot'] + '"/>']
        if title:
            self.frame(title, sub)

    # ---------- 基元 ----------
    def T(self, x, y, s, st='nm', fill=None, anchor='middle', rot=None):
        fill = fill or self.C['line']
        tr = ''
        if rot is not None:
            tr = ' transform="rotate(%g %.2f %.2f)"' % (rot, x, y)
        self.s.append('<text x="%.2f" y="%.2f" style="%s" fill="%s" '
                      'text-anchor="%s"%s>%s</text>'
                      % (x, y, FONT[st], fill, anchor, tr, esc(s)))
        return self

    def Ln(self, pts, col=None, sw=0.6, dash=None, op=None):
        col = col or self.C['line']
        d = ' '.join('%.2f,%.2f' % (x, y) for x, y in pts)
        ds = ' stroke-dasharray="%s"' % dash if dash else ''
        op_ = ' opacity="%s"' % op if op else ''
        self.s.append('<polyline points="%s" fill="none" stroke="%s" '
                      'stroke-width="%s"%s%s/>' % (d, col, sw, ds, op_))
        return self

    def Rc(self, x, y, w, h, fill='none', stroke=None, sw=0.6,
           dash=None, op=None, rx=0):
        stroke = stroke or 'none'
        ds = ' stroke-dasharray="%s"' % dash if dash else ''
        op_ = ' opacity="%s"' % op if op else ''
        r = ' rx="%g"' % rx if rx else ''
        self.s.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" '
                      'fill="%s" stroke="%s" stroke-width="%s"%s%s%s/>'
                      % (x, y, w, h, fill, stroke, sw, ds, op_, r))
        return self

    def Ci(self, cx, cy, r, fill='none', stroke=None, sw=0.6):
        stroke = stroke or 'none'
        self.s.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s" '
                      'stroke="%s" stroke-width="%s"/>'
                      % (cx, cy, r, fill, stroke, sw))
        return self

    def Poly(self, pts, fill='none', stroke=None, sw=1.0, op=None):
        stroke = stroke or self.C['line']
        d = ' '.join('%.2f,%.2f' % p for p in pts)
        op_ = ' opacity="%s"' % op if op else ''
        self.s.append('<polygon points="%s" fill="%s" stroke="%s" '
                      'stroke-width="%s"%s/>' % (d, fill, stroke, sw, op_))
        return self

    # ---------- 图框 ----------
    def frame(self, title, sub=''):
        self.T(40, 30, title, 'ttl', '#1A1A18', 'start')
        if sub:
            self.T(40, 48, sub, 'sub', self.C['gray'], 'start')
        self.Ln([(40, 58), (self.w - 40, 58)], self.C['grayd'], 0.6)
        return self

    def mapper(self, AX, AY, scale, ox, oy):
        self.M = Mapper(AX, AY, scale, ox, oy)
        return self.M

    # ---------- 轴网 ----------
    def grid(self, M=None, labels_x=True, labels_y=True, r=8):
        """虚线轴网 + 轴号圈。横向轴号 1..n（左起），纵向轴号 A..（下起）。"""
        M = M or self.M
        for i, v in enumerate(M.AX):
            px = M.sx(v)
            self.Ln([(px, M.sy(M.AY[0]) - 16), (px, M.sy(M.AY[-1]) + 16)],
                    self.C['grayd'], 0.5, '5 3 1 3')
            if labels_x:
                self.Ci(px, M.sy(M.AY[0]) - 30, r, '#FFFFFF', self.C['gray'], 0.5)
                self.T(px, M.sy(M.AY[0]) - 26, str(i + 1), 'ax', self.C['gray'])
        for j, v in enumerate(M.AY):
            py = M.sy(v)
            self.Ln([(M.sx(M.AX[0]) - 16, py), (M.sx(M.AX[-1]) + 16, py)],
                    self.C['grayd'], 0.5, '5 3 1 3')
            if labels_y:
                self.Ci(M.sx(M.AX[0]) - 30, py, r, '#FFFFFF', self.C['gray'], 0.5)
                self.T(M.sx(M.AX[0]) - 30, py + 3, chr(65 + j), 'ax', self.C['gray'])
        return self

    # ---------- 房间 ----------
    def room(self, M, x0, y0, x1, y1, name, sub='', fill=None,
             stroke=None, st='nmb', sub_st='sb', mask=True):
        """画房间：底色 + 名称 + 面积。

        mask=True 时先在文字带位置铺一层与底色相同的遮罩，
        防止后续/先前的线条（如楼梯踏步）穿过文字。
        文字带宽度按文字长度自适应——长标签必须放宽遮罩，
        否则标签会溢出遮罩被线穿过（本技能 v1.0 踩过此坑）。
        """
        fill = fill if fill is not None else self.C['grayf']
        stroke = stroke if stroke is not None else self.C['grayd']
        px, py, pw, ph = M.box(x0, y0, x1, y1)
        self.Rc(px, py, pw, ph, fill, stroke, 0.9)
        cx, cy = px + pw / 2, py + ph / 2
        if mask:
            wm = max(124.0, len(name) * 13.5 + 20,
                     len(sub) * 8.6 + 20) if sub else max(100.0, len(name) * 13.5 + 20)
            wm = min(wm, pw - 6)
            hh = 46 if sub else 26
            self.Rc(cx - wm / 2, cy - hh / 2 - 2, wm, hh, fill, 'none', 0)
        if sub:
            self.T(cx, cy + 1, name, st, self.C['line'])
            self.T(cx, cy + 15, sub, sub_st, self.C['gray'])
        else:
            self.T(cx, cy + 4, name, st, self.C['line'])
        return self

    def fixture_bar(self, M, x0, y0, x1, y1, label='', sub='', fill=None,
                    label_side='below', pad=13):
        """固定构件条（神台 / 玄关柜 / 灶台 / 电视机位等）及其标注。

        ⚠️ 必须在 room() 之后调用，否则会被房间底色与遮罩盖住。
        标注默认放在条带的下方（label_side='below'）并自带文字遮罩，
        避免出现「字压在图例条上、深底深字看不清」的情况
        （本技能 v1.0 踩过此坑）。
        """
        fill = fill or self.C['amber']
        px, py, pw, ph = M.box(x0, y0, x1, y1)
        self.Rc(px, py, pw, ph, fill, fill, 0)
        if not (label or sub):
            return self
        cx = px + pw / 2
        lines = [t for t in (label, sub) if t]
        if label_side == 'below':
            ly = py + ph + pad
        elif label_side == 'above':
            ly = py - pad - 12 * (len(lines) - 1)
        else:
            ly = py - pad
        # 文字遮罩（与房间底色一致的浅色块），保证可读
        wm = max(len(t) * 9.2 + 18 for t in lines)
        hm = 15 * len(lines) + 6
        top = ly - 12 if label_side != 'above' else ly - 4
        self.Rc(cx - wm / 2, top, wm, hm, self.C['plot'], 'none', 0, op=0.92)
        for i, t in enumerate(lines):
            self.T(cx, ly + i * 14, t, 'sb' if i else 'nmb',
                   self.C['line'] if i else fill)
        return self

    # ---------- 楼梯 ----------
    def stair_l(self, M, x0, y0, x1, y1, steps=5, label=None):
        """L 型双跑楼梯示意。

        踏步线只画上下两段，中间留出空白带放房间名与面积——
        这是避免「踏步线穿过文字」的标准做法（本技能 v1.0 踩过此坑）。
        """
        px, py, pw, ph = M.box(x0, y0, x1, y1)
        mid = px + pw / 2
        band = 34.0                     # 文字带半高（像素）
        top_n = max(2, int((ph / 2 - band) / 8.5))
        bot_n = top_n
        for i in range(top_n):
            yy = py + 8 + i * 8.5
            self.Ln([(px + 6, yy), (mid - 4, yy)], self.C['grayd'], 0.7)
            self.Ln([(mid + 4, yy), (px + pw - 6, yy)], self.C['grayd'], 0.7)
        for i in range(bot_n):
            yy = py + ph / 2 + band + i * 8.5
            self.Ln([(px + 6, yy), (mid - 4, yy)], self.C['grayd'], 0.7)
            self.Ln([(mid + 4, yy), (px + pw - 6, yy)], self.C['grayd'], 0.7)
        # 中间休息平台分隔线
        self.Ln([(px + 6, py + ph / 2), (px + pw - 6, py + ph / 2)],
                self.C['grayd'], 0.8)
        if label:
            self.T(mid, py + ph / 2 - 2, label, 'nmb', self.C['line'])
        return self

    def stair_loop(self, M, x0, y0, x1, y1, well=None, seg=0.90, label=''):
        """回形（方形环绕）楼梯示意：四周环绕中央井道。

        well = (wx0, wy0, wx1, wy1) 中央电梯井范围（米）；
        若为 None 则按 seg 自动内缩。
        回形的价值：三面梯段靠墙靠井壁，无需扶手，且电梯出口与
        楼梯平台汇于一处 → 二三层不必另设电梯厅。
        """
        px, py, pw, ph = M.box(x0, y0, x1, y1)
        if well is None:
            wx0 = x0 + seg
            wy0 = y0 + seg
            wx1 = x1 - seg
            wy1 = y1 - seg
        else:
            wx0, wy0, wx1, wy1 = well
        qx, qy, qw, qh = M.box(wx0, wy0, wx1, wy1)

        # 四边梯段踏步线
        n = 4
        for i in range(1, n + 1):
            t = i / float(n + 1)
            # 南跑（下）
            self.Ln([(px + pw * t, qy + qh), (px + pw * t, py + ph)],
                    self.C['grayd'], 0.6)
            # 北跑（上）
            self.Ln([(px + pw * t, py), (px + pw * t, qy)], self.C['grayd'], 0.6)
        for j in range(1, n + 1):
            t = j / float(n + 1)
            # 西跑
            self.Ln([(px, py + ph * t), (qx, py + ph * t)], self.C['grayd'], 0.6)
            # 东跑
            self.Ln([(qx + qw, py + ph * t), (px + pw, py + ph * t)],
                    self.C['grayd'], 0.6)
        # 中央井道（打叉，建筑制图惯例表示井/洞）
        self.Rc(qx, qy, qw, qh, self.C['violetf'], self.C['violet'], 2.2)
        self.Ln([(qx, qy), (qx + qw, qy + qh)], self.C['violet'], 1.2)
        self.Ln([(qx + qw, qy), (qx, qy + qh)], self.C['violet'], 1.2)
        if label:
            self.T(qx + qw / 2, qy + qh / 2 - 4, label, 'nmb', self.C['violet'])
        return self

    # ---------- 尺寸 ----------
    def dim_h(self, M, v0, v1, yv, label='', col=None, off=0, tick=1.8,
              text_off=None):
        """水平尺寸线。off 为像素偏移（向下为正）。"""
        col = col or self.C['blue']
        x0, x1 = M.sx(v0), M.sx(v1)
        yy = M.sy(yv) + off
        self.Ln([(x0, yy), (x1, yy)], col, 0.45)
        for xx in (x0, x1):
            self.Ln([(xx, yy - tick), (xx, yy + tick)], col, 0.45)
        if label:
            dy = text_off if text_off is not None else -4
            self.T((x0 + x1) / 2, yy + dy, label, 'ax', col)
        return self

    def dim_v(self, M, v0, v1, xv, label='', col=None, off=0, tick=1.8,
              text_off=None):
        """垂直尺寸线。off 为像素偏移（向左为正）。"""
        col = col or self.C['blue']
        y0, y1 = M.sy(v0), M.sy(v1)
        xx = M.sx(xv) - off
        self.Ln([(xx, y0), (xx, y1)], col, 0.45)
        for yy in (y0, y1):
            self.Ln([(xx - tick, yy), (xx + tick, yy)], col, 0.45)
        if label:
            dx = text_off if text_off is not None else -4
            self.T(xx + dx, (y0 + y1) / 2 + 3, label, 'ax', col,
                   'middle', rot=-90)
        return self

    def dims_3level(self, M, AX, AY, face_y=None, side_x=None,
                    off_band=22, off_total=80):
        """三级尺寸标注（规范做法）：细分尺寸靠近图形、总尺寸在外。

        细分（开间 / 进深）逐段标注，总尺寸一次标注。
        禁止把细分与总尺寸画在同一条偏移线上。
        """
        face_y = M.AY[0] if face_y is None else face_y
        side_x = M.AX[-1] if side_x is None else side_x
        for i in range(len(AX) - 1):
            self.dim_h(M, AX[i], AX[i + 1], face_y,
                       '%.2f' % (AX[i + 1] - AX[i]), off=-(off_band + i * 0))
        self.dim_h(M, AX[0], AX[-1], face_y, '%.2f' % (AX[-1] - AX[0]),
                   self.C['red'], off=-off_total)
        for j in range(len(AY) - 1):
            self.dim_v(M, AY[j], AY[j + 1], side_x,
                       '%.2f' % (AY[j + 1] - AY[j]), off=-(off_band))
        self.dim_v(M, AY[0], AY[-1], side_x, '%.2f' % (AY[-1] - AY[0]),
                   self.C['red'], off=-(off_total))
        return self

    # ---------- 标注符号 ----------
    def elev(self, x, y, text, col=None, side='left', sz=7):
        """标高符号：等腰直角三角形（建筑制图惯例）。"""
        col = col or self.C['red']
        if side == 'left':
            self.Poly([(x, y), (x - sz, y + sz * 0.7), (x, y + sz * 0.7)], col, col, 0)
            self.T(x - sz - 3, y + sz * 0.5, text, 'ax', col, 'end')
        else:
            self.Poly([(x, y), (x + sz, y + sz * 0.7), (x, y + sz * 0.7)], col, col, 0)
            self.T(x + sz + 3, y + sz * 0.5, text, 'ax', col, 'start')
        return self

    def north(self, cx, cy, level, rot_deg, label='N'):
        """指北针。

        rot_deg = 屏幕上方顺时针到真北的角度。
        由界址点反算时：若 +X 真方位为 N a°E，则 rot_deg = -(a) 在
        「图纸 +Y 向下」的约定下成立。可用 site_geometry 的
        meta['bearing_x'] 直接代入验证：先画 a=0 的基准比对。
        """
        r = 14 * level
        self.Ci(cx, cy, r, '#FFFFFF', self.C['gray'], 0.7)
        self.s.append('<g transform="translate(%.2f,%.2f) rotate(%.2f)">'
                      % (cx, cy, rot_deg))
        self.s.append('<polygon points="0,%.2f 4,%.2f 0,%.2f -4,%.2f" '
                      'fill="%s"/>' % (-r * 0.55, r * 0.30, r * 0.02,
                                       r * 0.30, self.C['line']))
        self.s.append('<polygon points="0,%.2f 4,%.2f 0,%.2f -4,%.2f" '
                      'fill="none" stroke="%s" stroke-width="0.5"/>'
                      % (r * 0.02, r * 0.30, r * 0.55, r * 0.30, self.C['line']))
        self.s.append('</g>')
        self.T(cx, cy - r - 6, label, 'nmb', self.C['line'])
        return self

    def scale_bar(self, x, y, scale, total=5.0, seg_count=5, h=3.2):
        seg = total / float(seg_count)
        for i in range(seg_count):
            f = self.C['line'] if i % 2 == 0 else '#FFFFFF'
            self.Rc(x + i * seg * scale, y, seg * scale, h, f, self.C['line'], 0.5)
        for i in range(seg_count + 1):
            self.T(x + i * seg * scale, y + h + 11, '%g' % (i * seg),
                   'ax', self.C['gray'])
        self.T(x, y + h + 24, '比例尺（米）', 'ax', self.C['gray'], 'start')
        return self

    def legend(self, x, y, items, cols=1, col_w=190):
        """items: [(fill, stroke, label), ...]  自动折行"""
        for i, (f, st, lb) in enumerate(items):
            row, col = divmod(i, cols)
            xx = x + col * col_w
            yy = y + row * 16
            self.Rc(xx, yy - 9, 12, 10, f, st, 0.6)
            self.T(xx + 18, yy, lb, 'sb', self.C['gray'], 'start')
        return self

    def notes(self, items, y=None, x=32, lh=16.5, st='sb', col=None):
        """底部说明条目，自动编号 1．2．…"""
        y = y if y is not None else self.h - 24 - len(items) * lh
        col = col or self.C['gray']
        for i, t in enumerate(items):
            self.T(x, y + i * lh, '%d．%s' % (i + 1, t), st, col, 'start')
        return self

    # ---------- 输出 ----------
    def save(self, name, path='figs'):
        self.s.append('</svg>')
        os.makedirs(path, exist_ok=True)
        fp = os.path.join(path, '%s.svg' % name)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write('\n'.join(self.s))
        return fp


# ----------------------------------------------------------------------
# 轴网派生
# ----------------------------------------------------------------------
def grid_from(width, depth, count_x=3, count_y=3, origin=(0.0, 0.0)):
    """由主体净尺寸生成等开间等进深轴网。"""
    cw, cd = width / count_x, depth / count_y
    AX = [round(origin[0] + cw * i, 3) for i in range(count_x + 1)]
    AY = [round(origin[1] + cd * i, 3) for i in range(count_y + 1)]
    return AX, AY


def bearing_to_screen_rotation(bearing_x_deg):
    """由 +X 轴真方位角求指北针在屏幕上的旋转角。

    约定：图纸 +X 向右、+Y 向下。
    +X 真方位 N a°E  ⇒  真北方向 = +X 逆时针 a°  ⇒  屏幕旋转 = -a。
    """
    return -float(bearing_x_deg)
