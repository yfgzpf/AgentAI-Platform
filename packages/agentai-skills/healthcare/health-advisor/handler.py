#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
health-advisor - health-advisor 行业技能 (自动生成)
====================================
自动生成的标准化 handler, 通过 AgentAI 桥接器调用

支持的动作 (action):
  - symptom: 症状分析
  - lifestyle: 生活方式建议
  - report: 体检报告解读

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
    parser.add_argument('--symptoms', help='symptoms')
    parser.add_argument('--age', help='age')
    parser.add_argument('--gender', help='gender')
    parser.add_argument('--profile', help='profile')
    parser.add_argument('--goal', help='goal')
    parser.add_argument('--report_text', help='report_text')
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



def action_symptom(args):
    """症状分析"""
    return {
        'success': True,
        'action': 'symptom',
        'skill': 'health-advisor',
        'description': '症状分析',
        'params_received': {
            'input': getattr(args, 'input', None),
            'symptoms': getattr(args, 'symptoms', None),
            'age': getattr(args, 'age', None),
            'gender': getattr(args, 'gender', None),
        },
        'output': f'[health-advisor] action=symptom 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_symptom 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/healthcare/health-advisor/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_lifestyle(args):
    """生活方式建议"""
    return {
        'success': True,
        'action': 'lifestyle',
        'skill': 'health-advisor',
        'description': '生活方式建议',
        'params_received': {
            'input': getattr(args, 'input', None),
            'profile': getattr(args, 'profile', None),
            'goal': getattr(args, 'goal', None),
        },
        'output': f'[health-advisor] action=lifestyle 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_lifestyle 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/healthcare/health-advisor/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_report(args):
    """体检报告解读"""
    return {
        'success': True,
        'action': 'report',
        'skill': 'health-advisor',
        'description': '体检报告解读',
        'params_received': {
            'input': getattr(args, 'input', None),
            'report_text': getattr(args, 'report_text', None),
        },
        'output': f'[health-advisor] action=report 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_report 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/healthcare/health-advisor/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


ACTIONS = {
    'symptom': action_symptom,
    'lifestyle': action_lifestyle,
    'report': action_report
}



def main():
    args = get_args()
    action = args.action
    if not action:
        result = {
            'success': False,
            'output': '缺少 --action 参数. 可用动作: symptom, lifestyle, report',
            'available_actions': ["symptom", "lifestyle", "report"],
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {
            'success': False,
            'output': f'未知 action: {action}. 可用: symptom, lifestyle, report',
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
