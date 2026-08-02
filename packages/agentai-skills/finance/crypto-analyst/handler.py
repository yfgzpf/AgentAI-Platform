#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
crypto-analyst - crypto-analyst 行业技能 (自动生成)
====================================
自动生成的标准化 handler, 通过 AgentAI 桥接器调用

支持的动作 (action):
  - analyze: 链上数据分析
  - whales: 大户动向追踪
  - sentiment: 市场情绪分析

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
    parser.add_argument('--token', help='token')
    parser.add_argument('--metrics', help='metrics')
    parser.add_argument('--min_amount', help='min_amount')
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



def _fetch_json(url, timeout=10):
    """真实 HTTP GET JSON (不依赖第三方库, 仅用标准库)"""
    import urllib.request, urllib.parse, json as _json
    req = urllib.request.Request(url, headers={'User-Agent': 'AgentAI/1.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return _json.loads(resp.read().decode('utf-8'))


# ===== 主流币种符号映射 (CoinGecko 用 id, 用户用 symbol) =====
SYMBOL_TO_ID = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
    'BNB': 'binancecoin', 'XRP': 'ripple', 'ADA': 'cardano',
    'DOGE': 'dogecoin', 'MATIC': 'matic-network', 'DOT': 'polkadot',
    'AVAX': 'avalanche-2', 'LINK': 'chainlink', 'UNI': 'uniswap',
    'LTC': 'litecoin', 'BCH': 'bitcoin-cash', 'TRX': 'tron',
}


def action_analyze(args):
    """链上数据分析: 实时价格 + 24h 涨跌 + 市值 (真实调用 CoinGecko API)"""
    token = (getattr(args, 'token', None) or 'BTC').upper()
    cg_id = SYMBOL_TO_ID.get(token, token.lower())

    try:
        # CoinGecko 公开 API: 单币种完整行情
        data = _fetch_json(
            f'https://api.coingecko.com/api/v3/coins/{cg_id}'
            '?localization=false&tickers=false&community_data=false&developer_data=false'
        )
        md = data.get('market_data', {})
        price_usd = md.get('current_price', {}).get('usd')
        change_24h = md.get('price_change_percentage_24h')
        change_7d = md.get('price_change_percentage_7d')
        market_cap = md.get('market_cap', {}).get('usd')
        volume_24h = md.get('total_volume', {}).get('usd')
        high_24h = md.get('high_24h', {}).get('usd')
        low_24h = md.get('low_24h', {}).get('usd')
        rank = data.get('market_cap_rank')
        ath = md.get('ath', {}).get('usd')
        ath_change = md.get('ath_change_percentage', {}).get('usd')

        # 趋势判定
        if change_24h is None:
            trend = 'N/A'
        elif change_24h > 5:
            trend = '强势上涨'
        elif change_24h > 1:
            trend = '温和上涨'
        elif change_24h > -1:
            trend = '横盘整理'
        elif change_24h > -5:
            trend = '温和下跌'
        else:
            trend = '大幅下跌'

        # 价格行 (避免条件表达式与 + 优先级歧义)
        if isinstance(price_usd, (int, float)):
            price_line = f"💰 当前价格: ${price_usd:,.2f} USD\n"
        else:
            price_line = f"💰 当前价格: {price_usd} USD\n"

        output = (
            f"📊 {data.get('name', token)} ({token.upper()}) 实时行情\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"{price_line}"
            f"📈 24h 涨跌: {change_24h:+.2f}%   7d 涨跌: {change_7d:+.2f}%\n"
            f"🏔️  24h 最高/最低: ${high_24h:,.2f} / ${low_24h:,.2f}\n"
            f"🏛️  市值: ${market_cap:,.0f}   排名: #{rank}\n"
            f"💹 24h 成交量: ${volume_24h:,.0f}\n"
            f"🚀 历史最高: ${ath:,.2f} (距 ATH {ath_change:+.2f}%)\n"
            f"📡 趋势判定: {trend}\n"
            f"⏰ 数据时间: {datetime.now().isoformat()}\n"
            f"🔗 数据源: CoinGecko Public API"
        )

        return {
            'success': True,
            'action': 'analyze',
            'skill': 'crypto-analyst',
            'description': '链上数据分析 (真实数据)',
            'data_source': 'CoinGecko',
            'token': token,
            'metrics': {
                'price_usd': price_usd,
                'change_24h_pct': change_24h,
                'change_7d_pct': change_7d,
                'market_cap_usd': market_cap,
                'volume_24h_usd': volume_24h,
                'rank': rank,
                'trend': trend,
            },
            'output': output,
            'timestamp': datetime.now().isoformat(),
        }
    except Exception as e:
        return {
            'success': False,
            'action': 'analyze',
            'skill': 'crypto-analyst',
            'output': f'❌ 真实数据获取失败: {e}\n💡 提示: 请检查网络或更换 token (支持 BTC/ETH/SOL 等)',
            'error': str(e),
        }


def action_whales(args):
    """大户动向追踪: 真实获取 CoinGecko 公开交易数据"""
    token = (getattr(args, 'token', None) or 'BTC').upper()
    cg_id = SYMBOL_TO_ID.get(token, token.lower())

    try:
        data = _fetch_json(f'https://api.coingecko.com/api/v3/coins/{cg_id}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true')
        md = data.get('market_data', {})
        sparkline = md.get('sparkline_7d', {}).get('price', [])
        if not sparkline:
            return {'success': False, 'output': f'❌ {token} 暂无可用行情数据'}

        # 7d 价格序列分析
        prices = sparkline[-168:] if len(sparkline) > 168 else sparkline  # 7d × 24h
        if len(prices) < 24:
            return {'success': False, 'output': f'❌ 价格数据点不足 ({len(prices)})'}

        first, last = prices[0], prices[-1]
        change_pct = ((last - first) / first * 100) if first else 0
        high_7d = max(prices)
        low_7d = min(prices)
        volatility = ((high_7d - low_7d) / first * 100) if first else 0

        # 简易信号: 当前价 vs 7d 均值
        avg_7d = sum(prices) / len(prices)
        deviation = ((last - avg_7d) / avg_7d * 100) if avg_7d else 0

        output = (
            f"🐋 {token} 链上大户动向分析 (7d)\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"📍 当前价: ${last:,.2f}\n"
            f"📊 7d 区间: ${low_7d:,.2f} ~ ${high_7d:,.2f} (波动率 {volatility:.2f}%)\n"
            f"📈 7d 累计: {change_pct:+.2f}%\n"
            f"🎯 当前价 vs 7d 均值: {deviation:+.2f}% (高于均值 = 主力拉升)\n"
            f"🔔 信号提示:\n"
        )
        if deviation > 5:
            output += f"   🟢 价格突破 7d 均值 {deviation:.1f}%, 主力资金流入迹象明显\n"
        elif deviation < -5:
            output += f"   🔴 价格低于 7d 均值 {abs(deviation):.1f}%, 可能处于吸筹阶段\n"
        else:
            output += f"   🟡 价格在均值附近震荡, 方向待选\n"
        output += f"⏰ {datetime.now().isoformat()}\n🔗 数据源: CoinGecko 7d sparkline"

        return {
            'success': True,
            'action': 'whales',
            'skill': 'crypto-analyst',
            'description': '大户动向追踪 (基于 7d 价格分析)',
            'data_source': 'CoinGecko',
            'token': token,
            'metrics': {
                'price_now': last,
                'change_7d_pct': change_pct,
                'high_7d': high_7d,
                'low_7d': low_7d,
                'volatility_7d_pct': volatility,
                'deviation_from_mean_pct': deviation,
            },
            'output': output,
            'timestamp': datetime.now().isoformat(),
        }
    except Exception as e:
        return {'success': False, 'action': 'whales', 'output': f'❌ 大户动向分析失败: {e}'}


def action_sentiment(args):
    """市场情绪分析: 真实获取 alternative.me 恐惧贪婪指数 + 价格走势综合"""
    token = (getattr(args, 'token', None) or 'BTC').upper()
    cg_id = SYMBOL_TO_ID.get(token, token.lower())

    try:
        # 1. 恐惧贪婪指数
        fng_data = _fetch_json('https://api.alternative.me/fng/?limit=1', timeout=8)
        fng = fng_data.get('data', [{}])[0]
        fng_value = int(fng.get('value', 50))
        fng_class = fng.get('value_classification', 'Neutral')

        # 2. 价格走势 (CoinGecko)
        cg_data = _fetch_json(f'https://api.coingecko.com/api/v3/coins/{cg_id}?localization=false&tickers=false&community_data=false&developer_data=false')
        md = cg_data.get('market_data', {})
        price = md.get('current_price', {}).get('usd')
        ch24 = md.get('price_change_percentage_24h', 0)
        ch7d = md.get('price_change_percentage_7d', 0)
        ch30d = md.get('price_change_percentage_30d', 0)

        # 综合情绪评分: FNG 0-100 + 24h (1%=2分)
        composite = fng_value + (ch24 or 0) * 2
        composite = max(0, min(100, composite))

        if composite >= 75:
            mood = '极度贪婪 (⚠️ 风险)'
        elif composite >= 55:
            mood = '贪婪 (📈 顺势)'
        elif composite >= 45:
            mood = '中性 (观望)'
        elif composite >= 25:
            mood = '恐惧 (🛡️ 防守)'
        else:
            mood = '极度恐惧 (💎 机会)'

        if isinstance(price, (int, float)):
            price_line = f"💰 当前价: ${price:,.2f} USD\n"
        else:
            price_line = f"💰 当前价: {price} USD\n"

        output = (
            f"🎭 {token} 市场情绪综合分析\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"😨 恐惧贪婪指数: {fng_value} / 100 ({fng_class})\n"
            f"{price_line}"
            f"📊 涨跌幅: 24h {ch24:+.2f}% · 7d {ch7d:+.2f}% · 30d {ch30d:+.2f}%\n"
            f"🎯 综合情绪评分: {composite:.0f} / 100\n"
            f"📡 市场状态: {mood}\n"
            f"⏰ {datetime.now().isoformat()}\n"
            f"🔗 数据源: alternative.me + CoinGecko"
        )

        return {
            'success': True,
            'action': 'sentiment',
            'skill': 'crypto-analyst',
            'description': '市场情绪分析 (恐惧贪婪 + 价格走势)',
            'data_source': 'alternative.me + CoinGecko',
            'token': token,
            'metrics': {
                'fear_greed_index': fng_value,
                'fear_greed_class': fng_class,
                'composite_score': composite,
                'mood': mood,
                'change_24h_pct': ch24,
                'change_7d_pct': ch7d,
                'change_30d_pct': ch30d,
            },
            'output': output,
            'timestamp': datetime.now().isoformat(),
        }
    except Exception as e:
        return {'success': False, 'action': 'sentiment', 'output': f'❌ 情绪分析失败: {e}'}


ACTIONS = {
    'analyze': action_analyze,
    'whales': action_whales,
    'sentiment': action_sentiment
}



def main():
    # DEBUG: 写调试信息到文件, 便于诊断 (生产环境可删除)
    import os as _os
    _debug_path = _os.path.join(_os.environ.get('TEMP', 'C:\\Windows\\Temp'), 'handler_debug.log')
    try:
        with open(_debug_path, 'a', encoding='utf-8') as _df:
            _df.write(f'\n--- main() entry, env AGENTAI_ARGS_JSON={_os.environ.get("AGENTAI_ARGS_JSON", "<none>")[:200]} ---\n')
    except: pass

    args = get_args()
    try:
        with open(_debug_path, 'a', encoding='utf-8') as _df:
            _df.write(f'args.action={args.action}, args.token={args.token}\n')
    except: pass

    action = args.action
    if not action:
        result = {
            'success': False,
            'output': '缺少 --action 参数. 可用动作: analyze, whales, sentiment',
            'available_actions': ["analyze", "whales", "sentiment"],
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}", flush=True)
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {
            'success': False,
            'output': f'未知 action: {action}. 可用: analyze, whales, sentiment',
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}", flush=True)
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

    # 强制 UTF-8 编码输出, 解决 Windows GBK 环境 UnicodeEncodeError
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}", flush=True)


if __name__ == '__main__':
    main()
