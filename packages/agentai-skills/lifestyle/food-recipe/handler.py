#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
food-recipe - food-recipe 行业技能 (自动生成)
====================================
自动生成的标准化 handler, 通过 AgentAI 桥接器调用

支持的动作 (action):
  - recipe: 菜谱生成
  - pairing: 配菜建议
  - nutrition: 营养分析

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
    parser.add_argument('--ingredients', help='ingredients')
    parser.add_argument('--cuisine', help='cuisine')
    parser.add_argument('--difficulty', help='difficulty')
    parser.add_argument('--main_dish', help='main_dish')
    parser.add_argument('--dish', help='dish')
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



def action_recipe(args):
    """菜谱生成"""
    return {
        'success': True,
        'action': 'recipe',
        'skill': 'food-recipe',
        'description': '菜谱生成',
        'params_received': {
            'input': getattr(args, 'input', None),
            'ingredients': getattr(args, 'ingredients', None),
            'cuisine': getattr(args, 'cuisine', None),
            'difficulty': getattr(args, 'difficulty', None),
        },
        'output': f'[food-recipe] action=recipe 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_recipe 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/lifestyle/food-recipe/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_pairing(args):
    """配菜建议"""
    return {
        'success': True,
        'action': 'pairing',
        'skill': 'food-recipe',
        'description': '配菜建议',
        'params_received': {
            'input': getattr(args, 'input', None),
            'main_dish': getattr(args, 'main_dish', None),
        },
        'output': f'[food-recipe] action=pairing 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_pairing 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/lifestyle/food-recipe/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_nutrition(args):
    """营养分析"""
    return {
        'success': True,
        'action': 'nutrition',
        'skill': 'food-recipe',
        'description': '营养分析',
        'params_received': {
            'input': getattr(args, 'input', None),
            'dish': getattr(args, 'dish', None),
        },
        'output': f'[food-recipe] action=nutrition 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_nutrition 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/lifestyle/food-recipe/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


ACTIONS = {
    'recipe': action_recipe,
    'pairing': action_pairing,
    'nutrition': action_nutrition
}



def main():
    args = get_args()
    action = args.action
    if not action:
        result = {
            'success': False,
            'output': '缺少 --action 参数. 可用动作: recipe, pairing, nutrition',
            'available_actions': ["recipe", "pairing", "nutrition"],
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {
            'success': False,
            'output': f'未知 action: {action}. 可用: recipe, pairing, nutrition',
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
