#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data-analyst - data-analyst 行业技能 (自动生成)
====================================
自动生成的标准化 handler, 通过 AgentAI 桥接器调用

支持的动作 (action):
  - clean: 数据清洗
  - stats: 统计分析
  - viz: 可视化方案

调用示例:
  python handler.py --action backtest --strategy ma_cross --symbol 600519.SH
  python handler.py --action signals --strategy turtle --symbol BTC

返回:
  最后一行 ##RESULT## {json} 会被 AgentAI 自动解析
"""
import argparse
import json
import os
import sys
from datetime import datetime


def get_args():
    """读取参数: 优先 CLI flag, 其次环境变量 AGENTAI_ARGS_JSON"""
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--action', help='操作类型')
    parser.add_argument('--input', help='通用输入 (如用户消息)')
    parser.add_argument('--context', help='上下文 JSON')
    parser.add_argument('--data', help='data')
    parser.add_argument('--rules', help='rules')
    parser.add_argument('--metrics', help='metrics')
    parser.add_argument('--chart_type', help='chart_type')
    args = parser.parse_known_args()[0]

    # 如果有环境变量, 合并
    env_args_str = os.environ.get('AGENTAI_ARGS_JSON', '')
    if env_args_str:
        try:
            env_args = json.loads(env_args_str)
            for k, v in env_args.items():
                if not hasattr(args, k) or getattr(args, k) is None:
                    setattr(args, k, v)
        except Exception:
            pass

    return args



def action_clean(args):
    """数据清洗"""
    return {
        'success': True,
        'action': 'clean',
        'skill': 'data-analyst',
        'description': '数据清洗',
        'params_received': {
            'input': getattr(args, 'input', None),
            'data': getattr(args, 'data', None),
            'rules': getattr(args, 'rules', None),
        },
        'output': f'[data-analyst] action=clean 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_clean 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/data/data-analyst/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_stats(args):
    """统计分析"""
    return {
        'success': True,
        'action': 'stats',
        'skill': 'data-analyst',
        'description': '统计分析',
        'params_received': {
            'input': getattr(args, 'input', None),
            'data': getattr(args, 'data', None),
            'metrics': getattr(args, 'metrics', None),
        },
        'output': f'[data-analyst] action=stats 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_stats 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/data/data-analyst/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_viz(args):
    """可视化方案"""
    return {
        'success': True,
        'action': 'viz',
        'skill': 'data-analyst',
        'description': '可视化方案',
        'params_received': {
            'input': getattr(args, 'input', None),
            'data': getattr(args, 'data', None),
            'chart_type': getattr(args, 'chart_type', None),
        },
        'output': f'[data-analyst] action=viz 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_viz 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/data/data-analyst/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


ACTIONS = {
    'clean': action_clean,
    'stats': action_stats,
    'viz': action_viz
}



def main():
    args = get_args()
    action = args.action
    if not action:
        result = {
            'success': False,
            'output': '缺少 --action 参数. 可用动作: clean, stats, viz',
            'available_actions': ["clean", "stats", "viz"],
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {
            'success': False,
            'output': f'未知 action: {action}. 可用: clean, stats, viz',
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        return

    try:
        result = handler(args)
        if not isinstance(result, dict):
            result = {'success': True, 'output': str(result)}
        if 'success' not in result:
            result['success'] = True
    except Exception as e:
        import traceback
        result = {
            'success': False,
            'output': f'执行失败: {e}',
            'error_detail': traceback.format_exc()[:1000],
        }

    print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")


if __name__ == '__main__':
    main()
