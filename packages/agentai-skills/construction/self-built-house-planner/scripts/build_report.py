# -*- coding: utf-8 -*-
"""
正式汇报文件生成器（Word + PDF）
================================

面向农村自建房规划方案的「设计方 → 业主」正式汇报文件。
本模块只提供**经过实战验证的排版骨架**，内容由调用方填入。

五条硬规矩（全部来自实战踩坑，别改）：

 1. **章首分页用 paragraph_format.page_break_before，禁止 add_page_break()**
    分页符方式在「上一页恰好排满」时会多出一整页空白。

 2. **图片按纵横比自适应，禁止写死宽度**
    w = min(max_w_cm, max_h_cm / (h/w))，否则长图（总平面）会溢出版心。

 3. **表格每行加 <w:cantSplit/>，表头行加 <w:tblHeader/>**
    否则会出现一行字孤零零落在下一页。

 4. **目录页码用「两遍法」**：先生成 docx → 导出 PDF → 用 pymupdf
    按「整行等于章名」定位真实页码 → 把页码写回重新生成。
    不要用 Word 域（打开时会弹「更新域」）；也不要用标题整体匹配
    （PDF 提取会把标题断成两行）。

 5. **导出 PDF 走临时文件再替换**
    目标 PDF 被阅读器占用时 Word 会静默失败且文件时间不变。
    做法：SaveAs 到 _tmp.pdf → os.replace 覆盖；再失败则另存新名。

正文样式：宋体 10.5pt / 行距 1.5；标题用内置 Heading 1/2（可在
Word「视图 → 导航窗格」逐章跳转，也便于人工改排版）。
"""

import os
import shutil

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BODY_FONT = '宋体'
HEAD_FONT = '黑体'
BODY_PT = 10.5
LINE_SPACING = 1.5
PAGE_MARGIN_CM = 2.2
CONTENT_W_CM = 21.0 - 2 * PAGE_MARGIN_CM      # 16.6
CONTENT_H_CM = 29.7 - 2 * PAGE_MARGIN_CM      # 25.3


# ----------------------------------------------------------------------
# 字体 / 表格底层工具
# ----------------------------------------------------------------------
def _set_font(run, name=BODY_FONT, size=BODY_PT, bold=False, color=None):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    if color:
        run.font.color.rgb = RGBColor(*color)
    run._element.rPr.rFonts.set(qn('w:eastAsia'), name)


def _shade(cell, hexcolor):
    el = OxmlElement('w:shd')
    el.set(qn('w:val'), 'clear')
    el.set(qn('w:fill'), hexcolor)
    cell._tc.get_or_add_tcPr().append(el)


def _cant_split(row):
    """禁止该行跨页断开 —— 消除孤行页的关键。"""
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement('w:cantSplit')
    trPr.append(el)


def _repeat_header(row):
    """表头行跨页重复。"""
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement('w:tblHeader')
    trPr.append(el)


# ----------------------------------------------------------------------
# 报告骨架
# ----------------------------------------------------------------------
class Report:
    def __init__(self, cover_title, cover_sub='', cover_meta=None,
                 footer_text=''):
        self.doc = Document()
        self._setup_page()
        self._setup_styles()
        if footer_text:
            self._footer(footer_text)
        self._cover(cover_title, cover_sub, cover_meta or [])
        self._toc_items = []

    # ---------- 初始化 ----------
    def _setup_page(self):
        sec = self.doc.sections[0]
        sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
        for a in ('top_margin', 'bottom_margin', 'left_margin', 'right_margin'):
            setattr(sec, a, Cm(PAGE_MARGIN_CM))

    def _setup_styles(self):
        st = self.doc.styles['Normal']
        st.font.name = BODY_FONT
        st.font.size = Pt(BODY_PT)
        st._element.rPr.rFonts.set(qn('w:eastAsia'), BODY_FONT)
        st.paragraph_format.line_spacing = LINE_SPACING
        st.paragraph_format.space_after = Pt(2)

        for name, size in [('Heading 1', 14), ('Heading 2', 11.5),
                           ('Heading 3', 10.5)]:
            s = self.doc.styles[name]
            s.font.name = HEAD_FONT
            s.font.size = Pt(size)
            s.font.bold = True
            s.font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)
            s._element.rPr.rFonts.set(qn('w:eastAsia'), HEAD_FONT)
            s.paragraph_format.line_spacing = LINE_SPACING
            s.paragraph_format.space_after = Pt(4)

    def _footer(self, text):
        for sec in self.doc.sections:
            p = sec.footer.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(text + '　')
            _set_font(r, BODY_FONT, 8.5, color=(0x7A, 0x78, 0x70))
            self._page_field(p)

    @staticmethod
    def _page_field(paragraph):
        r = paragraph.add_run()
        f1 = OxmlElement('w:fldChar'); f1.set(qn('w:fldCharType'), 'begin')
        it = OxmlElement('w:instrText'); it.set(qn('xml:space'), 'preserve')
        it.text = ' PAGE '
        f2 = OxmlElement('w:fldChar'); f2.set(qn('w:fldCharType'), 'end')
        r._r.append(f1); r._r.append(it); r._r.append(f2)

    def _cover(self, title, sub, meta):
        for _ in range(4):
            self.doc.add_paragraph()
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run(title), HEAD_FONT, 24, True, (0x1A, 0x1A, 0x1A))
        if sub:
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _set_font(p.add_run(sub), HEAD_FONT, 13, False, (0x55, 0x53, 0x4E))
        for _ in range(3):
            self.doc.add_paragraph()
        for k, v in meta:
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _set_font(p.add_run('%s　%s' % (k, v)), BODY_FONT, 10.5,
                      color=(0x7A, 0x78, 0x70))

    # ---------- 章节 ----------
    def h1(self, text, newpage=True):
        """章标题。newpage=True 用段落属性分页（不产生空白页）。"""
        p = self.doc.add_paragraph(style='Heading 1')
        if newpage:
            p.paragraph_format.page_break_before = True
        p.paragraph_format.space_before = Pt(12)
        _set_font(p.add_run(text), HEAD_FONT, 14, True, (0x1A, 0x1A, 0x1A))
        return p

    def h2(self, text, newpage=False):
        p = self.doc.add_paragraph(style='Heading 2')
        if newpage:
            p.paragraph_format.page_break_before = True
        _set_font(p.add_run(text), HEAD_FONT, 11.5, True, (0x1A, 0x1A, 0x1A))
        return p

    def para(self, text, indent=True):
        p = self.doc.add_paragraph()
        if indent:
            p.paragraph_format.first_line_indent = Pt(21)
        _set_font(p.add_run(text))
        return p

    def bullet(self, text):
        p = self.doc.add_paragraph()
        p.paragraph_format.left_indent = Pt(18)
        _set_font(p.add_run(text))
        return p

    def note(self, text):
        """楷体小字提示（重要提醒、待核项）。"""
        p = self.doc.add_paragraph()
        p.paragraph_format.left_indent = Pt(18)
        p.paragraph_format.space_before = Pt(4)
        _set_font(p.add_run(text), '楷体', 9.5, color=(0x7A, 0x51, 0x10))
        return p

    def quote(self, text):
        """引文块（核心主张）。

        ⚠️ 引号必须用「」（U+300C/U+300D）。曾用 ❝（U+275D），楷体字库里
        没有该字，Word 里渲染成空心方块（本技能 v1.0 踩过此坑）。
        """
        p = self.doc.add_paragraph()
        p.paragraph_format.left_indent = Pt(28)
        p.paragraph_format.right_indent = Pt(14)
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(6)
        _set_font(p.add_run('「%s」' % text), '楷体', 11,
                  color=(0x8A, 0x5A, 0x0B))
        return p

    # ---------- 表格 ----------
    def table(self, headers, rows, widths=None, fs=9.0,
              header_fill='F2F0EA', align_center_cols=None):
        """标准表。widths 单位 cm，其总和须 ≤ 16.6。"""
        t = self.doc.add_table(rows=1, cols=len(headers))
        t.style = 'Table Grid'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        if widths and sum(widths) > CONTENT_W_CM + 0.01:
            raise ValueError('表格列宽合计 %.2f cm 超出可用宽度 %.2f cm'
                             % (sum(widths), CONTENT_W_CM))
        hdr = t.rows[0]
        for i, h in enumerate(headers):
            c = hdr.cells[i]
            c.text = ''
            _set_font(c.paragraphs[0].add_run(str(h)), HEAD_FONT, fs, True)
            c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            _shade(c, header_fill)
        _cant_split(hdr)
        _repeat_header(hdr)

        for r in rows:
            row = t.add_row()
            _cant_split(row)
            for i, v in enumerate(r):
                c = row.cells[i]
                c.text = ''
                _set_font(c.paragraphs[0].add_run(str(v)), BODY_FONT, fs)
                if align_center_cols and i in align_center_cols:
                    c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        if widths:
            for row in t.rows:
                for i, w in enumerate(widths):
                    row.cells[i].width = Cm(w)
        return t

    # ---------- 插图 ----------
    def figure(self, path, caption, max_h_cm=17.0, max_w_cm=None,
               auto_shot=True):
        """按纵横比自适应插入图片，保证完整落在版心内。

        两个要点：
        1. 必须读真实像素尺寸算比例；只写宽度会让长图（总平面）溢出页面。
        2. PNG 缺失但同名 SVG 存在时，**自动调用 shot 转换**再插入。
           否则会静默退化成"图片缺失"占位框 —— 出图与排版常常分两步跑，
           这一步能省掉人工干预。
        """
        max_w_cm = max_w_cm or CONTENT_W_CM
        if not os.path.exists(path) and auto_shot:
            svg = os.path.splitext(path)[0] + '.svg'
            if os.path.exists(svg):
                try:
                    import shot as _shot
                    path, _, _ = _shot.shot(os.path.splitext(
                        os.path.basename(path))[0],
                        os.path.dirname(path) or '.',
                        None, 2)
                except Exception:
                    pass

        if os.path.exists(path):
            try:
                from PIL import Image
                iw, ih = Image.open(path).size
            except Exception:
                iw, ih = 1, 1
            r = ih / float(iw) if iw else 1.0
            w = min(max_w_cm, max_h_cm / r)
            h = w * r
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(6)
            p.add_run().add_picture(path, width=Cm(w), height=Cm(h))
            cp = self.doc.add_paragraph()
            cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            cp.paragraph_format.space_after = Pt(6)
            _set_font(cp.add_run(caption), HEAD_FONT, 9.5)
            return cp
        self.slot('%s（图片缺失：%s）' % (caption, path), h_cm=4.5)
        return None

    def slot(self, caption, h_cm=6.0):
        """效果图占位框（业主后续自行贴图）。

        行高用 `<w:trHeight w:hRule="exact">` 固定 —— 靠塞空段落撑高在
        Word 里不可靠（空段落会被压缩），占位框会扁成一条线（本技能 v1.0 踩过此坑）。
        """
        t = self.doc.add_table(rows=1, cols=1)
        t.style = 'Table Grid'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        row = t.rows[0]
        trPr = row._tr.get_or_add_trPr()
        th = OxmlElement('w:trHeight')
        th.set(qn('w:val'), str(int(h_cm * 567)))   # 1 cm = 567 twips
        th.set(qn('w:hRule'), 'exact')
        trPr.append(th)
        cell = row.cells[0]
        cell.width = Cm(CONTENT_W_CM)
        cell.text = ''
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run('［　效果图占位　］\n出图后请选中本框，插入图片并删除本行'),
                  HEAD_FONT, 10, color=(0xB0, 0xAD, 0xA4))
        cp = self.doc.add_paragraph()
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp.paragraph_format.space_after = Pt(6)
        _set_font(cp.add_run(caption), BODY_FONT, 9, color=(0x7A, 0x78, 0x70))
        return t

    def page_break(self):
        p = self.doc.add_paragraph()
        p.paragraph_format.page_break_before = True
        return p

    # ---------- 目录 ----------
    def toc(self, items):
        """items = [(章名, 页码), ...]。页码由两遍法回填。"""
        self._toc_items = items
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run('目　　录'), HEAD_FONT, 16, True)
        for name, page in items:
            q = self.doc.add_paragraph()
            q.paragraph_format.space_after = Pt(6)
            _set_font(q.add_run('%s\t%s' % (name, page)), BODY_FONT, 10.5)

    # ---------- 保存 ----------
    def save(self, path):
        self.doc.save(path)
        return path


# ----------------------------------------------------------------------
# PDF 导出（两遍法 / 防占用）
# ----------------------------------------------------------------------
def docx_to_pdf(docx_path, pdf_path, word_timeout_s=180):
    """用本机 Word 导出 PDF。

    关键：**先写临时文件再搬运**。目标文件被阅读器占用时，
    直接 SaveAs 到目标会静默失败（文件时间不变、内容仍旧），
    排查起来极耗时（本技能 v1.0 踩过此坑）。

    返回 (pdf_path, 说明)
    """
    import win32com.client as wc
    tmp = pdf_path + '.tmp.pdf'
    if os.path.exists(tmp):
        try:
            os.remove(tmp)
        except OSError:
            pass
    app = wc.Dispatch('Word.Application')
    app.Visible = False
    try:
        doc = app.Documents.Open(os.path.abspath(docx_path), False, True)
        doc.SaveAs(os.path.abspath(tmp), 17)   # 17 = wdFormatPDF
        doc.Close(False)
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    try:
        os.replace(tmp, pdf_path)
        return pdf_path, 'ok'
    except OSError:
        alt = pdf_path.replace('.pdf', '_新.pdf')
        shutil.move(tmp, alt)
        return alt, '目标 PDF 被占用，已另存为 %s' % os.path.basename(alt)


def read_page_numbers(pdf_path, chapter_titles, skip_pages=1,
                      at_top_ratio=0.35, toc_ratio=0.4):
    """两遍法第二步：从 PDF 读取各章真实起始页。

    这里有三个必须绕开的坑（本技能 v1.0 都踩过）：

      1. **标题会被断行**：PDF 文本提取把「第一章　项目概况」按全角空格
         切成两行 `第一章` / `项目概况`，整行等值匹配永远失败。
         → 解法：整页文本去掉所有空白后再做子串匹配
           （`str.split()` 会吃掉全角空格 U+3000）。

      2. **目录页也会命中**：目录里同样是完整章名清单，且排在正文之前。
         → 解法：不能写死"跳过 2 页"（目录可能与封面同页，也可能独占数页）。
           改为自动识别 —— 一页若同时出现 ≥ toc_ratio 比例的章名，
           即判为目录页并剔除。

      3. **页眉页脚污染**：整页扁平化后页脚可能把上一行与下一行粘连。
         → 解法：优先在页面上部 at_top_ratio 区域内匹配（标题位置）。

    返回 {章名（原文）: 页码}。
    """
    import pymupdf
    doc = pymupdf.open(pdf_path)
    norm = {t: ''.join(t.split()) for t in chapter_titles}

    # 第一步：逐页收集「上部区域命中情况」与「全页命中情况」
    top_hits, all_hits = {}, {}
    for i in range(doc.page_count):
        page = doc[i]
        try:
            top = page.get_text('text', clip=pymupdf.Rect(
                0, 0, page.rect.width, page.rect.height * at_top_ratio))
        except Exception:
            top = page.get_text()
        ft = ''.join(top.split())
        fa = ''.join(page.get_text().split())
        tset = {t for t in chapter_titles if norm[t] and norm[t] in ft}
        aset = {t for t in chapter_titles if norm[t] and norm[t] in fa}
        top_hits[i] = tset
        all_hits[i] = aset

    # 第二步：识别目录页（命中章名数量占比过高）
    n_min = max(3, int(len(chapter_titles) * toc_ratio))
    toc_pages = {i for i in top_hits if len(top_hits[i]) >= n_min}
    if not toc_pages and chapter_titles:
        # 兜底：取命中数最多的那一页为目录页（仅当它明显多于其他页时）
        best = max(top_hits, key=lambda i: len(top_hits[i]))
        if len(top_hits[best]) >= n_min:
            toc_pages = {best}

    # 第三步：正文中首次出现即该章起始页
    found = {}
    for i in range(doc.page_count):
        if i < skip_pages or i in toc_pages:
            continue
        for t in (top_hits[i] or all_hits[i]):
            if t not in found:
                found[t] = i + 1
    doc.close()
    return found


def audit_pdf(pdf_path, sparse_threshold=240):
    """版面体检：找出空白页 / 近乎空白页。"""
    import pymupdf
    doc = pymupdf.open(pdf_path)
    sparse, figs = [], []
    for i in range(doc.page_count):
        t = doc[i].get_text().strip()
        n_img = len(doc[i].get_images())
        if n_img:
            figs.append(i + 1)
        if len(t) < sparse_threshold and n_img == 0:
            sparse.append((i + 1, len(t)))
    n = doc.page_count
    doc.close()
    return {'pages': n, 'sparse_pages': sparse, 'figure_pages': figs}


if __name__ == '__main__':
    print('本模块为库文件，请 import 使用。')
    print('可用宽度 %.1f cm / 可用高度 %.1f cm' % (CONTENT_W_CM, CONTENT_H_CM))
