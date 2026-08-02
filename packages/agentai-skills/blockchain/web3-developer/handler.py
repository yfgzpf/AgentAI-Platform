#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
web3-developer - web3-developer 行业技能 (自动生成)
====================================
自动生成的标准化 handler, 通过 AgentAI 桥接器调用

支持的动作 (action):
  - contract: 智能合约生成
  - audit: 合约审计
  - deploy: 部署脚本

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
    parser.add_argument('--spec', help='spec')
    parser.add_argument('--language', help='language')
    parser.add_argument('--code', help='code')
    parser.add_argument('--focus', help='focus')
    parser.add_argument('--network', help='network')
    parser.add_argument('--contract_path', help='contract_path')
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



def action_contract(args):
    """智能合约生成"""
    return {
        'success': True,
        'action': 'contract',
        'skill': 'web3-developer',
        'description': '智能合约生成',
        'params_received': {
            'input': getattr(args, 'input', None),
            'spec': getattr(args, 'spec', None),
            'language': getattr(args, 'language', None),
        },
        'output': f'[web3-developer] action=contract 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_contract 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/blockchain/web3-developer/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_audit(args):
    """合约审计"""
    return {
        'success': True,
        'action': 'audit',
        'skill': 'web3-developer',
        'description': '合约审计',
        'params_received': {
            'input': getattr(args, 'input', None),
            'code': getattr(args, 'code', None),
            'focus': getattr(args, 'focus', None),
        },
        'output': f'[web3-developer] action=audit 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_audit 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/blockchain/web3-developer/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


def action_deploy(args):
    """部署脚本"""
    return {
        'success': True,
        'action': 'deploy',
        'skill': 'web3-developer',
        'description': '部署脚本',
        'params_received': {
            'input': getattr(args, 'input', None),
            'network': getattr(args, 'network', None),
            'contract_path': getattr(args, 'contract_path', None),
        },
        'output': f'[web3-developer] action=deploy 已执行. 输入={args.input or "无"}, 时间={datetime.now().isoformat()}.\n\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_deploy 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/blockchain/web3-developer/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }


ACTIONS = {
    'contract': action_contract,
    'audit': action_audit,
    'deploy': action_deploy
}



def main():
    args = get_args()
    action = args.action
    if not action:
        result = {
            'success': False,
            'output': '缺少 --action 参数. 可用动作: contract, audit, deploy',
            'available_actions': ["contract", "audit", "deploy"],
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {
            'success': False,
            'output': f'未知 action: {action}. 可用: contract, audit, deploy',
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
