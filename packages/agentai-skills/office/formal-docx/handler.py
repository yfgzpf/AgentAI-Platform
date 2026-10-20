#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
formal-docx —— 统一入口（AgentAI 桥接器标准协议）
==================================================
定位：把结构化内容生成**排版规范的正式 Word 文档**（.docx）。
封面 / 目录 / 章节 / 表格 / 图片自适应 / 引文块 / 占位框 / 页脚页码，
生成后自动版面自检。适用于合同协议、研报汇报、公文、说明书等正式文档。

读参数：CLI flag 优先，其次环境变量 AGENTAI_ARGS_JSON。
输出：最后一行 `##RESULT## {json}` 会被 AgentAI 自动解析。

支持的动作 (action)：
  build   按 JSON 规格生成 docx（主动作）
  audit   对已生成 docx 做版面体检

调用示例：
  python handler.py --action build --input '{"out":"协议.docx","title":"……","chapters":[…]}'
  python handler.py --action audit --input '{"path":"协议.docx"}'
"""

import argparse
import json
import os
import sys

_SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_SKILL_DIR, 'scripts'))

SKILL = 'formal-docx'


# ----------------------------------------------------------------------
# 参数读取
# ----------------------------------------------------------------------
def get_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--action')
    parser.add_argument('--input')        # 通用输入（JSON 串或文件路径）
    parser.add_argument('--data')         # 本动作的 JSON 串
    parser.add_argument('--spec')         # build 的规格 JSON 串
    parser.add_argument('--path')         # audit 的文件路径
    parser.add_argument('--out')          # 输出路径
    args = parser.parse_known_args()[0]

    env_str = os.environ.get('AGENTAI_ARGS_JSON', '')
    if env_str:
        try:
            env = json.loads(env_str)
            for k, v in env.items():
                if getattr(args, k, None) in (None, '', []):
                    setattr(args, k, v)
        except Exception:
            pass
    return args


def _load_json(value):
    """value 可以是 JSON 串，也可以是 .json 文件路径。"""
    if not value:
        return None
    if isinstance(value, dict):
        return value
    s = str(value).strip()
    if s.startswith('{') or s.startswith('['):
        return json.loads(s)
    if os.path.exists(s):
        with open(s, encoding='utf-8') as f:
            return json.load(f)
    return json.loads(s)


# ----------------------------------------------------------------------
# 动作
# ----------------------------------------------------------------------
def action_build(args):
    spec = _load_json(args.spec or args.data or args.input)
    if not isinstance(spec, dict):
        return {'success': False, 'error': 'build 需要 JSON 规格（--spec/--data/--input）'}
    out = args.out or spec.get('out') or spec.get('output')
    if not out:
        return {'success': False, 'error': '缺少输出路径（--out 或 spec.out）'}

    from build_docx import build_document, audit_document
    stats = build_document(spec, out)
    audit = audit_document(out)
    return {
        'success': True,
        'action': 'build',
        'output': out,
        'stats': stats,
        'audit': audit,
    }


def action_audit(args):
    path = args.path
    if not path:
        # 桥接器可能把参数放在 --data / --input（JSON 串或 dict）
        d = _load_json(args.data or args.input)
        if isinstance(d, dict):
            path = d.get('path')
    if not path:
        return {'success': False, 'error': 'audit 需要文件路径（--path 或 data.path）'}

    from build_docx import audit_document
    audit = audit_document(path)
    return {
        'success': audit.get('success', False),
        'action': 'audit',
        'output': audit.get('verdict'),
        'audit': audit,
    }


ACTIONS = {
    'build': action_build,
    'audit': action_audit,
}


def main():
    args = get_args()
    action = (args.action or '').strip()
    fn = ACTIONS.get(action)
    if fn is None:
        result = {
            'success': False,
            'error': '未知动作：%r（可用：%s）' % (action, '/'.join(sorted(ACTIONS))),
        }
    else:
        try:
            result = fn(args)
        except Exception as e:
            import traceback
            result = {
                'success': False,
                'action': action,
                'error': str(e),
                'error_detail': traceback.format_exc()[-800:],
            }
    # 协议硬约束：最后一行必须是 ##RESULT## {json}
    print('##RESULT## %s' % json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
