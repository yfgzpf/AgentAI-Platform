#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ecommerce-ops - ecommerce-ops 行业技能 (自动生成)
====================================
自动生成的标准化 handler, 通过 AgentAI 桥接器调用

支持的动作 (action):
  - listing: 商品 listing 优化
  - pricing: 定价建议
  - campaign: 营销活动方案

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
    parser.add_argument('--title', help='title')
    parser.add_argument('--keywords', help='keywords')
    parser.add_argument('--platform', help='platform')
    parser.add_argument('--product', help='product')
    parser.add_argument('--competitors', help='competitors')
    parser.add_argument('--goal', help='goal')
    parser.add_argument('--budget', help='budget')
    parser.add_argument('--duration', help='duration')
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



def action_listing(args):
    """商品 listing 优化"""
    return {
        'success': True,
        'action': 'listing',
        'skill': 'ecommerce-ops',
        'description': '商品 listing 优化',
        'params_received': {
            'input': getattr(args, 'input', None),
            'title': getattr(args, 'title', None),
            'keywords': getattr(args, 'keywords', None),
            'platform': getattr(args, 'platform', None),
        },
        'output': f'[ecommerce-ops] action=listing 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_listing 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/ecommerce/ecommerce-ops/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_pricing(args):
    """定价建议"""
    return {
        'success': True,
        'action': 'pricing',
        'skill': 'ecommerce-ops',
        'description': '定价建议',
        'params_received': {
            'input': getattr(args, 'input', None),
            'product': getattr(args, 'product', None),
            'competitors': getattr(args, 'competitors', None),
        },
        'output': f'[ecommerce-ops] action=pricing 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_pricing 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/ecommerce/ecommerce-ops/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_campaign(args):
    """营销活动方案"""
    return {
        'success': True,
        'action': 'campaign',
        'skill': 'ecommerce-ops',
        'description': '营销活动方案',
        'params_received': {
            'input': getattr(args, 'input', None),
            'goal': getattr(args, 'goal', None),
            'budget': getattr(args, 'budget', None),
            'duration': getattr(args, 'duration', None),
        },
        'output': f'[ecommerce-ops] action=campaign 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_campaign 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/ecommerce/ecommerce-ops/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


ACTIONS = {
    'listing': action_listing,
    'pricing': action_pricing,
    'campaign': action_campaign
}



def main():
    args = get_args()
    action = args.action
    if not action:
        result = {
            'success': False,
            'output': '缺少 --action 参数. 可用动作: listing, pricing, campaign',
            'available_actions': ["listing", "pricing", "campaign"],
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {
            'success': False,
            'output': f'未知 action: {action}. 可用: listing, pricing, campaign',
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
