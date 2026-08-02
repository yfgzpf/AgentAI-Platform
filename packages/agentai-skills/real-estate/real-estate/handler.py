#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
real-estate - real-estate 行业技能 (自动生成)
====================================
自动生成的标准化 handler, 通过 AgentAI 桥接器调用

支持的动作 (action):
  - valuation: 房产估值
  - compare: 区域对比
  - report: 市场分析报告

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
    parser.add_argument('--location', help='location')
    parser.add_argument('--area', help='area')
    parser.add_argument('--year_built', help='year_built')
    parser.add_argument('--locations', help='locations')
    parser.add_argument('--metrics', help='metrics')
    parser.add_argument('--region', help='region')
    parser.add_argument('--period', help='period')
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



def action_valuation(args):
    """房产估值"""
    return {
        'success': True,
        'action': 'valuation',
        'skill': 'real-estate',
        'description': '房产估值',
        'params_received': {
            'input': getattr(args, 'input', None),
            'location': getattr(args, 'location', None),
            'area': getattr(args, 'area', None),
            'year_built': getattr(args, 'year_built', None),
        },
        'output': f'[real-estate] action=valuation 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_valuation 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/real-estate/real-estate/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_compare(args):
    """区域对比"""
    return {
        'success': True,
        'action': 'compare',
        'skill': 'real-estate',
        'description': '区域对比',
        'params_received': {
            'input': getattr(args, 'input', None),
            'locations': getattr(args, 'locations', None),
            'metrics': getattr(args, 'metrics', None),
        },
        'output': f'[real-estate] action=compare 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_compare 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/real-estate/real-estate/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_report(args):
    """市场分析报告"""
    return {
        'success': True,
        'action': 'report',
        'skill': 'real-estate',
        'description': '市场分析报告',
        'params_received': {
            'input': getattr(args, 'input', None),
            'region': getattr(args, 'region', None),
            'period': getattr(args, 'period', None),
        },
        'output': f'[real-estate] action=report 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_report 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/real-estate/real-estate/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


ACTIONS = {
    'valuation': action_valuation,
    'compare': action_compare,
    'report': action_report
}



def main():
    args = get_args()
    action = args.action
    if not action:
        result = {
            'success': False,
            'output': '缺少 --action 参数. 可用动作: valuation, compare, report',
            'available_actions': ["valuation", "compare", "report"],
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {
            'success': False,
            'output': f'未知 action: {action}. 可用: valuation, compare, report',
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
