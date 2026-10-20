#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
正式 Word 文档生成库
====================
把结构化 JSON 规格变成排版规范的 .docx：封面 / 目录 / 章节 / 表格 /
图片自适应 / 引文块 / 占位框 / 页脚页码，生成后自动版面自检。

排版规则（全部经过实战验证，改动前先读 pitfalls）：
- 章首分页用 page_break_before 属性，**不用分页符**（分页符会夹空白页）
- 表格行 cantSplit，表头浅灰底纹
- 图片必须读真实像素算纵横比，宽高双约束（只写宽度长图会溢出）
- 引文块用全角「」，**不用 ❝**（楷体无此字形，渲染成空心方块）
- 占位框用 trHeight exact 撑高（空段落会被 Word 压缩）
- 页脚页码用 PAGE / NUMPAGES 域代码
"""

import os

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BODY_FONT = '宋体'
HEAD_FONT = '黑体'
KAI_FONT = '楷体'

CONTENT_W_CM = 15.6          # A4 21cm - 左右各 2.7cm
GREY_HEAD = 'E8E8E8'         # 表头底纹
GREY_TEXT = RGBColor(0x7A, 0x78, 0x70)
BROWN = RGBColor(0x8A, 0x5A, 0x0B)


# ----------------------------------------------------------------------
# 基础工具
# ----------------------------------------------------------------------
def _set_font(run, name=BODY_FONT, size=12, bold=False, color=None):
    """同时设置西文与东亚字体，否则中文回落默认字体。"""
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:eastAsia'), name)


def _shade(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)


def _cant_split(row):
    trPr = row._tr.get_or_add_trPr()
    cs = OxmlElement('w:cantSplit')
    trPr.append(cs)


def _row_height(row, cm, exact=True):
    trPr = row._tr.get_or_add_trPr()
    h = OxmlElement('w:trHeight')
    h.set(qn('w:val'), str(int(cm * 567)))   # cm → twips
    h.set(qn('w:hRule'), 'exact' if exact else 'atLeast')
    trPr.append(h)


def _field(paragraph, instr):
    """插入 Word 域代码（PAGE / NUMPAGES 等）。"""
    run = paragraph.add_run()
    fld_begin = OxmlElement('w:fldChar')
    fld_begin.set(qn('w:fldCharType'), 'begin')
    instr_el = OxmlElement('w:instrText')
    instr_el.set(qn('xml:space'), 'preserve')
    instr_el.text = instr
    fld_end = OxmlElement('w:fldChar')
    fld_end.set(qn('w:fldCharType'), 'end')
    run._element.append(fld_begin)
    run._element.append(instr_el)
    run._element.append(fld_end)
    return run


def _page_footer(section, text=''):
    """页脚：左文字 + 右「第 X 页 / 共 Y 页」。"""
    footer = section.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0]
    p.text = ''
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if text:
        _set_font(p.add_run(text + '　　'), BODY_FONT, 9, color=GREY_TEXT)
    _set_font(p.add_run('第 '), BODY_FONT, 9, color=GREY_TEXT)
    _set_font(_field(p, 'PAGE'), BODY_FONT, 9, color=GREY_TEXT)
    _set_font(p.add_run(' 页 / 共 '), BODY_FONT, 9, color=GREY_TEXT)
    _set_font(_field(p, 'NUMPAGES'), BODY_FONT, 9, color=GREY_TEXT)
    _set_font(p.add_run(' 页'), BODY_FONT, 9, color=GREY_TEXT)


def _setup_page(doc):
    """A4 纵向，常规公文页边距。"""
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.54)
    sec.bottom_margin = Cm(2.54)
    sec.left_margin = Cm(2.7)
    sec.right_margin = Cm(2.7)
    return sec


def _style_headings(doc):
    """Heading 1/2 用黑体，去掉默认蓝色。"""
    for name, size in (('Heading 1', 16), ('Heading 2', 14)):
        st = doc.styles[name]
        st.font.name = HEAD_FONT
        st.font.size = Pt(size)
        st.font.color.rgb = RGBColor(0, 0, 0)
        st.font.bold = True
        rPr = st.element.get_or_add_rPr()
        rFonts = rPr.find(qn('w:rFonts'))
        if rFonts is None:
            rFonts = OxmlElement('w:rFonts')
            rPr.append(rFonts)
        rFonts.set(qn('w:eastAsia'), HEAD_FONT)


# ----------------------------------------------------------------------
# 内容构件
# ----------------------------------------------------------------------
def _para(doc, text, size=12, font=BODY_FONT, bold=False, align='justify',
          indent=True, color=None, space_after=6):
    p = doc.add_paragraph()
    p.alignment = {
        'justify': WD_ALIGN_PARAGRAPH.JUSTIFY,
        'center': WD_ALIGN_PARAGRAPH.CENTER,
        'left': WD_ALIGN_PARAGRAPH.LEFT,
        'right': WD_ALIGN_PARAGRAPH.RIGHT,
    }[align]
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.5
    if indent:
        pf.first_line_indent = Pt(size * 2)
    _set_font(p.add_run(text), font, size, bold=bold, color=color)
    return p


def _table(doc, headers, rows, widths=None):
    t = doc.add_table(rows=1 + len(rows), cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, h in enumerate(headers):
        cell = t.rows[0].cells[j]
        cell.text = ''
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run(str(h)), HEAD_FONT, 10.5, bold=True)
        _shade(cell, GREY_HEAD)
    for i, row in enumerate(rows):
        _cant_split(t.rows[i + 1])
        for j, v in enumerate(row):
            cell = t.rows[i + 1].cells[j]
            cell.text = ''
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if j == 0 else WD_ALIGN_PARAGRAPH.LEFT
            _set_font(p.add_run(str(v)), BODY_FONT, 10.5)
    if widths:
        total = sum(widths)
        for j, w in enumerate(widths):
            for r in t.rows:
                r.cells[j].width = Cm(CONTENT_W_CM * w / total)
    _cant_split(t.rows[0])
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def _figure(doc, path, caption, max_h_cm=14.0, max_w_cm=None):
    """按真实像素纵横比自适应插图；文件缺失则出占位框。"""
    max_w_cm = max_w_cm or CONTENT_W_CM
    if os.path.exists(path):
        try:
            from PIL import Image
            iw, ih = Image.open(path).size
            r = ih / float(iw) if iw else 1.0
        except Exception:
            r = 0.75
        w = min(max_w_cm, max_h_cm / r)
        h = w * r
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(6)
        p.add_run().add_picture(path, width=Cm(w), height=Cm(h))
    else:
        _slot(doc, caption + '（图片缺失：%s）' % path)
        return
    cp = doc.add_paragraph()
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cp.paragraph_format.space_after = Pt(6)
    _set_font(cp.add_run(caption), HEAD_FONT, 9.5)


def _slot(doc, caption, h_cm=4.5):
    """占位框（效果图等后续贴图位）。"""
    t = doc.add_table(rows=1, cols=1)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = t.rows[0].cells[0]
    cell.width = Cm(CONTENT_W_CM)
    cell.text = ''
    _row_height(t.rows[0], h_cm)
    p = cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(p.add_run('［　效果图占位　］'), HEAD_FONT, 11, color=GREY_TEXT)
    cp = doc.add_paragraph()
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(cp.add_run(caption), BODY_FONT, 9, color=GREY_TEXT)
    return t


def _quote(doc, text):
    """引文块：全角「」+ 楷体 + 棕色（❝ 楷体无字形，禁用）。"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Pt(28)
    pf.right_indent = Pt(14)
    pf.space_before = Pt(6)
    pf.space_after = Pt(6)
    _set_font(p.add_run('「 ' + text + ' 」'), KAI_FONT, 11, color=BROWN)
    return p


def _note(doc, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Pt(14)
    pf.space_after = Pt(6)
    _set_font(p.add_run('注：' + text), KAI_FONT, 10.5, color=GREY_TEXT)
    return p


# ----------------------------------------------------------------------
# 主入口
# ----------------------------------------------------------------------
def build_document(spec, out_path):
    """按 spec 生成 docx。spec 结构见 SKILL.md。返回审计信息 dict。"""
    doc = Document()
    sec = _setup_page(doc)
    _style_headings(doc)
    _page_footer(sec, spec.get('footer', ''))

    stats = {'chapters': 0, 'sections': 0, 'paras': 0, 'tables': 0,
             'figures': 0, 'slots': 0, 'quotes': 0, 'missing_images': []}

    # ---- 封面（可选）----
    # 垂直布局一律用段前距实现，不用空段落撑（空段落会被版面自检误报）
    if spec.get('title'):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(140)
        _set_font(p.add_run(spec['title']), HEAD_FONT, 26, bold=True)
        if spec.get('subtitle'):
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(18)
            _set_font(p.add_run(spec['subtitle']), KAI_FONT, 16,
                      color=GREY_TEXT)
        first_meta = True
        for k, v in spec.get('meta', []):
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            if first_meta:
                p.paragraph_format.space_before = Pt(110)
                first_meta = False
            _set_font(p.add_run('%s：%s' % (k, v)), BODY_FONT, 14)
        if spec.get('cover_date', True):
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(24)
            _set_font(p.add_run(spec.get('date_text', '二〇二六年十月')),
                      BODY_FONT, 14)

    # ---- 目录（可选，仅列章节，页码以打印为准）----
    chapters = spec.get('chapters', [])
    if spec.get('toc') and chapters:
        doc.add_page_break()
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run('目　　录'), HEAD_FONT, 16, bold=True)
        for ch in chapters:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(4)
            _set_font(p.add_run(ch.get('title', '')), BODY_FONT, 12)

    # ---- 正文 ----
    for ci, ch in enumerate(chapters):
        stats['chapters'] += 1
        h = doc.add_heading(level=1)
        h.alignment = WD_ALIGN_PARAGRAPH.CENTER
        h.paragraph_format.page_break_before = True   # 章首分页，禁分页符
        _set_font(h.add_run(ch.get('title', '')), HEAD_FONT, 16, bold=True)
        for sec_item in ch.get('sections', []):
            stats['sections'] += 1
            if sec_item.get('h2'):
                h2 = doc.add_heading(level=2)
                _set_font(h2.add_run(sec_item['h2']), HEAD_FONT, 14, bold=True)
            for para in sec_item.get('paras', []):
                _para(doc, para)
                stats['paras'] += 1
            for q in sec_item.get('quotes', []):
                _quote(doc, q)
                stats['quotes'] += 1
            for tb in sec_item.get('tables', []):
                _table(doc, tb['headers'], tb['rows'], tb.get('widths'))
                stats['tables'] += 1
            for fg in sec_item.get('figures', []):
                _figure(doc, fg['path'], fg.get('caption', ''),
                        fg.get('max_h_cm', 14.0))
                stats['figures'] += 1
                if not os.path.exists(fg['path']):
                    stats['missing_images'].append(fg['path'])
            for sl in sec_item.get('slots', []):
                _slot(doc, sl)
                stats['slots'] += 1
            for nt in sec_item.get('notes', []):
                _note(doc, nt)

    # ---- 签署页（可选）----
    if spec.get('signature'):
        doc.add_page_break()
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run('签 署 页'), HEAD_FONT, 16, bold=True)
        for block in spec['signature']:
            first = True
            for line in block:
                pp = _para(doc, line, indent=False, space_after=10)
                if first:
                    pp.paragraph_format.space_before = Pt(36)
                    first = False

    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    doc.save(out_path)
    stats['output'] = out_path
    stats['size_kb'] = round(os.path.getsize(out_path) / 1024.0, 1)
    return stats


# ----------------------------------------------------------------------
# 版面自检
# ----------------------------------------------------------------------
def audit_document(path):
    """对已生成 docx 做版面体检，返回问题清单。"""
    if not os.path.exists(path):
        return {'success': False, 'error': '文件不存在：%s' % path}
    doc = Document(path)
    issues = []
    paras = doc.paragraphs
    empty = sum(1 for p in paras if not p.text.strip())
    if len(paras) > 20 and empty / float(len(paras)) > 0.35:
        issues.append('空段落占比 %.0f%%，疑似排版异常' % (100.0 * empty / len(paras)))
    tables = doc.tables
    images = 0
    for rel in doc.part.rels.values():
        if 'image' in rel.reltype:
            images += 1
    for t in tables:
        if len(t.rows) > 1 and len(t.columns) > 1:
            if not t.rows[0].cells[0].text.strip():
                issues.append('存在表头为空的表格')
                break
    headings = [p for p in paras if p.style.name.startswith('Heading')]
    return {
        'success': True,
        'path': path,
        'paragraphs': len(paras),
        'empty_paragraphs': empty,
        'headings': len(headings),
        'tables': len(tables),
        'images': images,
        'size_kb': round(os.path.getsize(path) / 1024.0, 1),
        'issues': issues,
        'verdict': 'PASS' if not issues else 'WARN',
    }
