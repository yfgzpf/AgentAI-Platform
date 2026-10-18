#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
self-built-house-planner —— 统一入口（AgentAI 桥接器标准协议）
=================================================================
定位：**把手绘图 / 测绘图，收敛成轴网对齐、标注规范的建筑平面图**。
不局限于自建房 —— 任何"手绘图转平面图"都走同一套流程：
识读（人或多模态模型）→ 定轴网 → 合规校核 → 出图 → 出汇报文件。

读参数：CLI flag 优先，其次环境变量 AGENTAI_ARGS_JSON。
输出：最后一行 `##RESULT## {json}` 会被 AgentAI 自动解析。

支持的动作 (action)：
  analyze_site      地块几何反算（面积闭合校验 / 边长 / 方位角 / 斜界 / 内接矩形 / 轴网）
  derive_grid       由主体净尺寸推等开间等进深轴网
  compliance_check  规划合规自动校核（层数 / 面积 / 覆盖率 / 层高 / 楼梯 / 卫生间位置 …）
  shot              SVG → PNG 高清出图（Chrome headless）
  audit_pdf         PDF 版面体检（空白页 / 图纸页）
  read_page_numbers PDF 章节页码回读（做目录两遍法用）

调用示例：
  python handler.py --action derive_grid --input '{"width":9.6,"depth":8.4}'
  python handler.py --action compliance_check --input '{"site_area":110,"floors":3}'
  python handler.py --action shot --input '{"names":["c2_f1"],"dir":"figs"}'
"""

import argparse
import json
import os
import sys

_SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_SKILL_DIR, 'scripts'))

SKILL = 'self-built-house-planner'


# ----------------------------------------------------------------------
# 参数读取
# ----------------------------------------------------------------------
def get_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--action')
    parser.add_argument('--input')        # 通用输入（用户消息或 JSON 串）
    parser.add_argument('--context')      # 上下文 JSON
    parser.add_argument('--data')         # 本动作的 JSON 串
    parser.add_argument('--dir')          # 图件目录
    parser.add_argument('--names')        # 图名，逗号分隔
    parser.add_argument('--browser')      # Chrome/Edge 路径
    parser.add_argument('--scale', type=int, default=2)
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_known_args()[0]

    env_str = os.environ.get('AGENTAI_ARGS_JSON', '')
    if env_str:
        try:
            for k, v in json.loads(env_str).items():
                if getattr(args, k, None) in (None, '', []):
                    setattr(args, k, v)
        except Exception:
            pass

    # --data / --input 若是 JSON 串，解析成 dict 放进 args.payload
    args.payload = {}
    for key in ('data', 'input', 'context'):
        v = getattr(args, key, None)
        if isinstance(v, str) and v.strip().startswith('{'):
            try:
                args.payload.update(json.loads(v))
            except Exception:
                pass
        elif isinstance(v, dict):
            args.payload.update(v)
    return args


# ----------------------------------------------------------------------
# 动作
# ----------------------------------------------------------------------
def action_analyze_site(a):
    import site_geometry as g
    pts = a.payload.get('points')
    if not pts:
        return {'success': False,
                'output': '缺少 points（界址点数组）。'
                          '格式: [{"id":"J1","x":…,"y":…}, …]',
                'example': g.SELF_TEST}
    data = dict(a.payload)
    if data.get('inscribed_rect', True):
        data.setdefault('margin', 0.15)
    r = g.analyze(data)
    ac = r.get('area_check') or {}
    return {
        'success': True, 'skill': SKILL, 'action': 'analyze_site',
        'description': '地块几何反算',
        'area_computed': r['area_computed'],
        'area_closure_ok': ac.get('ok'),
        'area_note': ac.get('note'),
        'bearing_x': r['meta']['bearing_x'],
        'edges': r['edges'],
        'slant': r['slant'],
        'max_rect': r.get('max_rect'),
        'grid': r.get('grid'),
        'edge_check': r.get('edge_check'),
        'precheck_tips': r['precheck_tips'],
        'output': ('闭合面积 %.2f ㎡（校核 %s）；+X 方位 N%.2fE；'
                   '最大内接矩形 %s'
                   % (r['area_computed'], '通过' if ac.get('ok') else '不通过',
                      r['meta']['bearing_x'],
                      (str(r['max_rect']) if r.get('max_rect') else '—'))),
        'data': r,
    }


def action_derive_grid(a):
    import site_geometry as g
    w = float(a.payload.get('width') or 0)
    d = float(a.payload.get('depth') or 0)
    if not w or not d:
        return {'success': False,
                'output': '需要 width（面宽 m）与 depth（进深 m）'}
    nx = int(a.payload.get('count_x', 3))
    ny = int(a.payload.get('count_y', 3))
    origin = tuple(a.payload.get('origin', (0.0, 0.0)))
    g.grid_from = getattr(g, 'grid_from', None)          # draw_lib 提供
    res = g.derive_grid(w, d, nx, ny, origin)
    cw, cd = res['cell_w'], res['cell_d']
    res['AX'] = [round(origin[0] + cw * i, 3) for i in range(nx + 1)]
    res['AY'] = [round(origin[1] + cd * i, 3) for i in range(ny + 1)]
    return {'success': True, 'skill': SKILL, 'action': 'derive_grid',
            'description': '轴网推导',
            'output': '轴网 X=%s Y=%s；开间 %.2f × 进深 %.2f，标准格 %.2f ㎡；%s'
                      % (res['AX'], res['AY'], cw, cd, res['cell_area'],
                         ('警告: ' + '；'.join(res['warn'])) if res['warn'] else '无警告'),
            'data': res}


def action_compliance_check(a):
    import compliance as c
    r = c.check(a.payload)
    fails = [x for x in r['results'] if x['status'] == 'fail']
    warns = [x for x in r['results'] if x['status'] == 'warn']
    manuals = [x for x in r['results'] if x['status'] == 'manual']
    return {'success': True, 'skill': SKILL, 'action': 'compliance_check',
            'description': '规划合规校核',
            'summary': r['summary'],
            'failures': fails, 'warnings': warns, 'manual_items': manuals,
            'output': '%s｜不合规 %d 项、提示 %d 项、待人工 %d 项'
                      % (r['summary']['verdict'], len(fails), len(warns), len(manuals)),
            'data': r}


def action_shot(a):
    import shot as s
    names = a.payload.get('names') or a.names or []
    if isinstance(names, str):
        names = [x for x in names.replace('，', ',').split(',') if x]
    if not names:
        return {'success': False,
                'output': '需要 names（如 ["c2_f1","c3_f2"]）或 --names c2_f1,c3_f2'}
    figdir = a.payload.get('dir') or a.dir or 'figs'
    scale = int(a.payload.get('scale') or a.scale or 2)
    browser = a.payload.get('browser') or a.browser
    b = s.find_browser(browser)
    out = []
    for n in names:
        png, w, h = s.shot(n, figdir, b, scale)
        out.append({'name': n, 'png': png, 'viewbox': [w, h]})
    return {'success': True, 'skill': SKILL, 'action': 'shot',
            'description': 'SVG 转 PNG',
            'output': '已转换 %d 张：%s'
                      % (len(out), '、'.join(x['name'] for x in out)),
            'converted': out}


def action_audit_pdf(a):
    import build_report as b
    p = a.payload.get('pdf') or a.input
    if not p:
        return {'success': False, 'output': '需要 pdf 路径'}
    if not os.path.exists(p):
        return {'success': False, 'output': 'PDF 不存在: %s' % p}
    r = b.audit_pdf(p)
    return {'success': True, 'skill': SKILL, 'action': 'audit_pdf',
            'description': 'PDF 版面体检',
            'output': '共 %d 页；图纸页 %s；空白/稀疏页 %s'
                      % (r['pages'], r['figure_pages'],
                         (r['sparse_pages'] or '无')),
            'data': r}


def action_read_page_numbers(a):
    import build_report as b
    p = a.payload.get('pdf')
    titles = a.payload.get('titles') or []
    if not p or not titles:
        return {'success': False,
                'output': '需要 pdf 路径与 titles（章名列表）'}
    if not os.path.exists(p):
        return {'success': False, 'output': 'PDF 不存在: %s' % p}
    found = b.read_page_numbers(
        p, titles, int(a.payload.get('skip_pages', 1)))
    return {'success': True, 'skill': SKILL, 'action': 'read_page_numbers',
            'description': '章节页码回读',
            'output': '回读到 %d/%d 章：%s'
                      % (len(found), len(titles), found),
            'pages': found}


def action_build_report(a):
    """生成 Word 汇报文件（可选导出 PDF）。

    data 字段：
      out            输出 docx 路径（必填）
      title / subtitle / meta / footer
      chapters       [{'title': '第一章　…', 'sections': [
                        {'h2': '1.1　…', 'paras': [...], 'tables': [...],
                         'figures': [{'path': 'figs/c2_f1.png', 'caption': '图 2　一层平面图'}],
                         'slots':    ['效果图 1　正立面'],
                         'notes':    ['提示：…']}]}]
      toc            [[章名, 页码], ...]（页码可先用 0，两遍法再回填）
      export_pdf     true 时同时导出 PDF
    """
    import build_report as b
    out = a.payload.get('out')
    if not out:
        return {'success': False, 'output': '需要 out（输出 docx 路径）'}
    r = b.Report(a.payload.get('title', '规划设计方案汇报'),
                 a.payload.get('subtitle', ''),
                 [tuple(m) for m in (a.payload.get('meta') or [])],
                 footer_text=a.payload.get('footer', ''))
    if a.payload.get('toc'):
        r.toc([(t[0], t[1]) for t in a.payload['toc']])

    n_fig = n_tbl = n_slot = 0
    for ch in a.payload.get('chapters') or []:
        r.h1(ch['title'])
        for sec in ch.get('sections') or []:
            if sec.get('h2'):
                r.h2(sec['h2'])
            for t in sec.get('paras') or []:
                r.para(t)
            for q in sec.get('quotes') or []:
                r.quote(q)
            for bl in sec.get('bullets') or []:
                r.bullet(bl)
            for nt in sec.get('notes') or []:
                r.note(nt)
            for tb in sec.get('tables') or []:
                r.table(tb['headers'], tb['rows'],
                        widths=tb.get('widths'), fs=tb.get('fs', 9.0))
                n_tbl += 1
            for fg in sec.get('figures') or []:
                r.figure(fg['path'], fg.get('caption', ''),
                         max_h_cm=fg.get('max_h_cm', 17.0))
                n_fig += 1
            for sl in sec.get('slots') or []:
                r.slot(sl)
                n_slot += 1
    r.save(out)

    res = {'success': True, 'skill': SKILL, 'action': 'build_report',
           'description': '生成汇报文件',
           'docx': out, 'chapters': len(a.payload.get('chapters') or []),
           'figures': n_fig, 'tables': n_tbl, 'slots': n_slot,
           'bytes': os.path.getsize(out)}
    if a.payload.get('export_pdf'):
        pdf, note = b.docx_to_pdf(out, out.replace('.docx', '.pdf'))
        res['pdf'] = pdf
        res['pdf_note'] = note
        res['audit'] = b.audit_pdf(pdf)
    res['output'] = ('已生成 %s（%d 章 / %d 图 / %d 表 / %d 占位框）%s'
                     % (os.path.basename(out), res['chapters'], n_fig, n_tbl,
                        n_slot, ('；PDF: ' + os.path.basename(pdf)) if a.payload.get('export_pdf') else ''))
    return res


ACTIONS = {
    'analyze_site': action_analyze_site,
    'derive_grid': action_derive_grid,
    'compliance_check': action_compliance_check,
    'shot': action_shot,
    'audit_pdf': action_audit_pdf,
    'read_page_numbers': action_read_page_numbers,
    'build_report': action_build_report,
}


def main():
    args = get_args()
    action = args.action
    if not action:
        print('##RESULT## ' + json.dumps({
            'success': False, 'skill': SKILL,
            'output': '缺少 --action 参数',
            'available_actions': list(ACTIONS.keys()),
        }, ensure_ascii=False))
        return

    handler = ACTIONS.get(action)
    if not handler:
        print('##RESULT## ' + json.dumps({
            'success': False, 'skill': SKILL,
            'output': '未知 action: %s' % action,
            'available_actions': list(ACTIONS.keys()),
        }, ensure_ascii=False))
        return

    try:
        result = handler(args)
        if not isinstance(result, dict):
            result = {'success': True, 'output': str(result)}
        result.setdefault('success', True)
    except Exception as e:
        import traceback
        result = {
            'success': False, 'skill': SKILL,
            'output': '执行失败: %s' % e,
            'error_detail': traceback.format_exc()[:1500],
        }
    print('##RESULT## ' + json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
