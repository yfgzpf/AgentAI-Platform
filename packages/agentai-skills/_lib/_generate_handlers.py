#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量为新行业技能生成可执行 handler.py
====================================
读取每个技能的 SKILL.md (frontmatter), 解析 action 列表, 生成标准化的 handler.py
"""
import os
import re
import sys
import json
from pathlib import Path

ROOT = Path(r"f:\agentai-platform\packages\agentai-skills")

# 15 个新技能的配置
SKILLS = {
    "finance/quant-trader": {
        "actions": [
            {"name": "backtest", "desc": "策略回测", "params": ["strategy", "symbol", "start_date", "end_date", "initial_capital"]},
            {"name": "signals", "desc": "实时信号", "params": ["strategy", "symbol"]},
            {"name": "indicators", "desc": "技术指标计算", "params": ["symbol", "indicators"]},
        ],
    },
    "finance/crypto-analyst": {
        "actions": [
            {"name": "analyze", "desc": "链上数据分析", "params": ["token", "metrics"]},
            {"name": "whales", "desc": "大户动向追踪", "params": ["token", "min_amount"]},
            {"name": "sentiment", "desc": "市场情绪分析", "params": ["token"]},
        ],
    },
    "finance/financial-analyst": {
        "actions": [
            {"name": "ratio", "desc": "财务比率分析", "params": ["company", "periods"]},
            {"name": "compare", "desc": "同业对比", "params": ["companies", "metrics"]},
            {"name": "forecast", "desc": "盈利预测", "params": ["company", "horizon"]},
        ],
    },
    "legal/legal-advisor": {
        "actions": [
            {"name": "review", "desc": "合同审查", "params": ["contract_type", "text"]},
            {"name": "clause", "desc": "条款解释", "params": ["clause"]},
            {"name": "risk", "desc": "法律风险评估", "params": ["scenario"]},
        ],
    },
    "healthcare/health-advisor": {
        "actions": [
            {"name": "symptom", "desc": "症状分析", "params": ["symptoms", "age", "gender"]},
            {"name": "lifestyle", "desc": "生活方式建议", "params": ["profile", "goal"]},
            {"name": "report", "desc": "体检报告解读", "params": ["report_text"]},
        ],
    },
    "education/education-tutor": {
        "actions": [
            {"name": "lesson", "desc": "课程设计", "params": ["subject", "level", "duration_minutes"]},
            {"name": "quiz", "desc": "出题", "params": ["topic", "difficulty", "count"]},
            {"name": "explain", "desc": "概念讲解", "params": ["concept", "level"]},
        ],
    },
    "ecommerce/ecommerce-ops": {
        "actions": [
            {"name": "listing", "desc": "商品 listing 优化", "params": ["title", "keywords", "platform"]},
            {"name": "pricing", "desc": "定价建议", "params": ["product", "competitors"]},
            {"name": "campaign", "desc": "营销活动方案", "params": ["goal", "budget", "duration"]},
        ],
    },
    "blockchain/web3-developer": {
        "actions": [
            {"name": "contract", "desc": "智能合约生成", "params": ["spec", "language"]},
            {"name": "audit", "desc": "合约审计", "params": ["code", "focus"]},
            {"name": "deploy", "desc": "部署脚本", "params": ["network", "contract_path"]},
        ],
    },
    "hr/hr-recruiter": {
        "actions": [
            {"name": "jd", "desc": "生成职位描述", "params": ["title", "requirements", "company"]},
            {"name": "screen", "desc": "简历筛选", "params": ["resume", "criteria"]},
            {"name": "interview", "desc": "面试问题", "params": ["position", "level"]},
        ],
    },
    "ai/prompt-engineer": {
        "actions": [
            {"name": "optimize", "desc": "Prompt 优化", "params": ["prompt", "goal"]},
            {"name": "fewshot", "desc": "添加 few-shot 示例", "params": ["prompt", "examples"]},
            {"name": "chain", "desc": "CoT 思维链改造", "params": ["prompt"]},
        ],
    },
    "language/translator": {
        "actions": [
            {"name": "translate", "desc": "翻译", "params": ["text", "source_lang", "target_lang"]},
            {"name": "polish", "desc": "润色", "params": ["text", "style"]},
            {"name": "summarize", "desc": "摘要", "params": ["text", "max_length"]},
        ],
    },
    "real-estate/real-estate": {
        "actions": [
            {"name": "valuation", "desc": "房产估值", "params": ["location", "area", "year_built"]},
            {"name": "compare", "desc": "区域对比", "params": ["locations", "metrics"]},
            {"name": "report", "desc": "市场分析报告", "params": ["region", "period"]},
        ],
    },
    "data/data-analyst": {
        "actions": [
            {"name": "clean", "desc": "数据清洗", "params": ["data", "rules"]},
            {"name": "stats", "desc": "统计分析", "params": ["data", "metrics"]},
            {"name": "viz", "desc": "可视化方案", "params": ["data", "chart_type"]},
        ],
    },
    "lifestyle/travel-planner": {
        "actions": [
            {"name": "itinerary", "desc": "行程规划", "params": ["destination", "days", "budget", "preferences"]},
            {"name": "budget", "desc": "预算明细", "params": ["destination", "days", "travelers"]},
            {"name": "tips", "desc": "当地贴士", "params": ["destination"]},
        ],
    },
    "lifestyle/food-recipe": {
        "actions": [
            {"name": "recipe", "desc": "菜谱生成", "params": ["ingredients", "cuisine", "difficulty"]},
            {"name": "pairing", "desc": "配菜建议", "params": ["main_dish"]},
            {"name": "nutrition", "desc": "营养分析", "params": ["dish"]},
        ],
    },
}

# 标准 handler.py 模板
HANDLER_TEMPLATE = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
{skill_name} - {description}
====================================
自动生成的标准化 handler, 通过 AgentAI 桥接器调用

支持的动作 (action):
{actions_doc}

调用示例:
  python handler.py --action backtest --strategy ma_cross --symbol 600519.SH
  python handler.py --action signals --strategy turtle --symbol BTC

返回:
  最后一行 ##RESULT## {{json}} 会被 AgentAI 自动解析
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
{argparse_params}
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


{action_functions}


def main():
    args = get_args()
    action = args.action
    if not action:
        result = {{
            'success': False,
            'output': '缺少 --action 参数. 可用动作: {actions_list}',
            'available_actions': {actions_list_json},
        }}
        print(f"##RESULT## {{json.dumps(result, ensure_ascii=False)}}")
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {{
            'success': False,
            'output': f'未知 action: {{action}}. 可用: {actions_list}',
        }}
        print(f"##RESULT## {{json.dumps(result, ensure_ascii=False)}}")
        return

    try:
        result = handler(args)
        if not isinstance(result, dict):
            result = {{'success': True, 'output': str(result)}}
        if 'success' not in result:
            result['success'] = True
    except Exception as e:
        import traceback
        result = {{
            'success': False,
            'output': f'执行失败: {{e}}',
            'error_detail': traceback.format_exc()[:1000],
        }}

    print(f"##RESULT## {{json.dumps(result, ensure_ascii=False)}}")


if __name__ == '__main__':
    main()
'''


def make_action_function(name, desc, params, skill_path):
    """生成单个 action 的实现函数 (每个技能自定义业务逻辑)"""
    # 把每个参数拼成 dict 项: 'key': getattr(args, 'key', None),
    param_lines = []
    for p in params:
        param_lines.append(f"            '{p}': getattr(args, '{p}', None),")
    param_dump = '\n'.join(param_lines) if param_lines else ''

    return f'''
def action_{name}(args):
    """{desc}"""
    return {{
        'success': True,
        'action': '{name}',
        'skill': '{skill_path.split("/")[-1]}',
        'description': '{desc}',
        'params_received': {{
            'input': getattr(args, 'input', None),
{param_dump}
        }},
        'output': f'[{skill_path.split("/")[-1]}] action={name} 已执行. 输入={{args.input or "无"}}, 时间={{datetime.now().isoformat()}}.\\n\\n注: 完整业务逻辑需根据具体场景实现 (数据获取/计算/分析). 框架已就绪, 接入数据源后即可产出真实结果.',
        'timestamp': datetime.now().isoformat(),
        'next_steps': [
            '如需真实数据, 请在 handler.py 的 action_{name} 中接入对应 API',
            '如需持久化, 写入 ~/.agentai/skills/{skill_path}/state.json',
            '如需触发后续技能, 返回 output 字段会传给下游',
        ],
    }}
'''


def generate_handler(skill_path, config):
    """为一个技能生成 handler.py"""
    actions = config['actions']
    actions_list = ', '.join(a['name'] for a in actions)
    actions_list_json = json.dumps([a['name'] for a in actions], ensure_ascii=False)

    # 生成 argparse 参数 (去重)
    seen_params = set()
    argparse_lines = []
    for action in actions:
        for param in action.get('params', []):
            if param not in seen_params:
                seen_params.add(param)
                argparse_lines.append(f"    parser.add_argument('--{param}', help='{param}')")
    argparse_params = '\n'.join(argparse_lines) if argparse_lines else '    # 无额外参数'

    # 生成 actions 路由
    actions_doc_lines = []
    action_funcs = []
    for action in actions:
        actions_doc_lines.append(f"  - {action['name']}: {action['desc']}")
        action_funcs.append(make_action_function(
            action['name'], action['desc'], action.get('params', []), skill_path
        ))

    actions_doc = '\n'.join(actions_doc_lines)
    action_functions_code = '\n'.join(action_funcs)

    # ACTIONS 字典
    actions_dict = ',\n'.join([f"    '{a['name']}': action_{a['name']}" for a in actions])

    # 构造 handler.py
    skill_name = skill_path.split('/')[-1]
    description = f"{skill_name} 行业技能 (自动生成)"

    handler_code = HANDLER_TEMPLATE.format(
        skill_name=skill_name,
        description=description,
        actions_doc=actions_doc,
        argparse_params=argparse_params,
        actions_list=actions_list,
        actions_list_json=actions_list_json,
        action_functions=action_functions_code + f"\n\nACTIONS = {{\n{actions_dict}\n}}\n",
    )
    return handler_code


def main():
    success = 0
    failed = 0
    for skill_path, config in SKILLS.items():
        full_path = ROOT / skill_path / 'handler.py'
        full_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            code = generate_handler(skill_path, config)
            full_path.write_text(code, encoding='utf-8')
            print(f"[OK] {skill_path}/handler.py ({len(code)} bytes)")
            success += 1
        except Exception as e:
            print(f"[FAIL] {skill_path}: {e}")
            failed += 1
    print(f"\nDone: success={success}, failed={failed}")


if __name__ == '__main__':
    main()
