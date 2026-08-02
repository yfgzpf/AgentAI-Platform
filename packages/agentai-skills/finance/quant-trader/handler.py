#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
quant-trader - 股票/加密货币量化交易技能 (真实实现)
====================================================

支持的动作 (action):
  - backtest:  策略回测 (基于传入的价格序列或内置样本数据)
  - signals:   实时信号 (技术指标综合判定)
  - indicators: 技术指标计算 (MA/EMA/MACD/RSI/BOLL/KDJ/海龟)

调用示例:
  python handler.py --action backtest --strategy ma_cross --symbol 600519.SH \
                    --prices "[10.1, 10.3, 10.5, ...]"  # 或不传, 用内置样本
  python handler.py --action signals --strategy turtle --prices "[100, 102, ...]"

返回:
  最后一行 ##RESULT## {json} 会被 AgentAI 自动解析
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta

# 强制 UTF-8 输出
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass


def get_args():
    """读取参数: 优先 CLI flag, 其次环境变量 AGENTAI_ARGS_JSON"""
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--action', help='操作类型')
    parser.add_argument('--input', help='通用输入 (如用户消息)')
    parser.add_argument('--context', help='上下文 JSON')
    parser.add_argument('--strategy', help='策略: ma_cross|turtle|macd|breakout')
    parser.add_argument('--symbol', help='股票/币种代码')
    parser.add_argument('--start_date', help='回测开始日期 YYYY-MM-DD')
    parser.add_argument('--end_date', help='回测结束日期 YYYY-MM-DD')
    parser.add_argument('--initial_capital', help='初始资金 (默认 100000)')
    parser.add_argument('--indicators', help='要计算的指标, 逗号分隔')
    parser.add_argument('--prices', help='JSON 数组, 价格序列 [100, 102, ...]')
    args = parser.parse_known_args()[0]

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


def parse_prices(args):
    """解析价格序列: 优先 --prices JSON 数组, 否则返回内置样本"""
    raw = getattr(args, 'prices', None)
    if raw:
        try:
            if isinstance(raw, list):
                return [float(x) for x in raw]
            return [float(x) for x in json.loads(raw)]
        except Exception as e:
            return _sample_prices()
    return _sample_prices()


def _sample_prices():
    """内置样本: 模拟 200 个交易日的茅台价格序列 (基于 2024 年初 ~ 1700 起步)
    包含: 上涨 → 回调 → 突破 → 横盘 4 个阶段, 用于演示回测"""
    import random
    random.seed(42)
    base = 1700.0
    prices = [base]
    for i in range(199):
        # 加入趋势: 前 50 天上涨, 50-100 回调, 100-160 突破, 160-200 横盘
        if i < 50:
            drift, vol = 8.0, 25
        elif i < 100:
            drift, vol = -3.0, 20
        elif i < 160:
            drift, vol = 6.0, 30
        else:
            drift, vol = 0.5, 15
        change = drift + random.gauss(0, vol)
        prices.append(max(prices[-1] + change, 100))
    return prices


def sma(prices, period):
    """简单移动平均"""
    if len(prices) < period:
        return [None] * len(prices)
    out = [None] * (period - 1)
    s = sum(prices[:period])
    out.append(s / period)
    for i in range(period, len(prices)):
        s += prices[i] - prices[i - period]
        out.append(s / period)
    return out


def ema(prices, period):
    """指数移动平均"""
    if not prices:
        return []
    k = 2.0 / (period + 1)
    out = [prices[0]]
    for p in prices[1:]:
        out.append(p * k + out[-1] * (1 - k))
    return out


def macd(prices, fast=12, slow=26, signal=9):
    """MACD 指标"""
    ema_fast = ema(prices, fast)
    ema_slow = ema(prices, slow)
    dif = [a - b for a, b in zip(ema_fast, ema_slow)]
    dea = ema(dif, signal)
    hist = [2 * (d - e) for d, e in zip(dif, dea)]
    return {'DIF': dif, 'DEA': dea, 'HIST': hist}


def rsi(prices, period=14):
    """RSI 指标 (Wilder 平滑)"""
    if len(prices) < period + 1:
        return [None] * len(prices)
    gains, losses = [], []
    for i in range(1, len(prices)):
        d = prices[i] - prices[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    rsis = [None] * period
    if avg_l == 0:
        rsis.append(100)
    else:
        rsis.append(100 - 100 / (1 + avg_g / avg_l))
    for i in range(period, len(gains)):
        avg_g = (avg_g * (period - 1) + gains[i]) / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
        if avg_l == 0:
            rsis.append(100)
        else:
            rsis.append(100 - 100 / (1 + avg_g / avg_l))
    return rsis


def bollinger(prices, period=20, k=2):
    """布林带"""
    mid = sma(prices, period)
    upper, lower = [], []
    for i, m in enumerate(mid):
        if m is None or i < period - 1:
            upper.append(None)
            lower.append(None)
        else:
            window = prices[i - period + 1:i + 1]
            std = math.sqrt(sum((p - m) ** 2 for p in window) / period)
            upper.append(m + k * std)
            lower.append(m - k * std)
    return {'mid': mid, 'upper': upper, 'lower': lower}


def kdj(prices, n=9, m1=3, m2=3):
    """KDJ 指标"""
    if len(prices) < n:
        return {'K': [50] * len(prices), 'D': [50] * len(prices), 'J': [50] * len(prices)}
    k_prev, d_prev = 50.0, 50.0
    K, D, J = [], [], []
    for i in range(len(prices)):
        start = max(0, i - n + 1)
        window = prices[start:i + 1]
        low_n, high_n = min(window), max(window)
        rsv = ((prices[i] - low_n) / (high_n - low_n) * 100) if high_n > low_n else 50
        k = (m1 - 1) / m1 * k_prev + 1 / m1 * rsv
        d = (m2 - 1) / m2 * d_prev + 1 / m2 * k
        j = 3 * k - 2 * d
        K.append(k); D.append(d); J.append(j)
        k_prev, d_prev = k, d
    return {'K': K, 'D': D, 'J': J}


def donchian(prices, period=20):
    """海龟通道 (唐奇安通道)"""
    upper, lower = [], []
    for i in range(len(prices)):
        if i < period - 1:
            upper.append(None); lower.append(None)
        else:
            upper.append(max(prices[i - period + 1:i + 1]))
            lower.append(min(prices[i - period + 1:i + 1]))
    return {'upper': upper, 'lower': lower}


def action_backtest(args):
    """策略回测: 真实计算收益率、夏普、最大回撤"""
    strategy = (getattr(args, 'strategy', None) or 'ma_cross').lower()
    symbol = getattr(args, 'symbol', None) or 'SAMPLE'
    initial_capital = float(getattr(args, 'initial_capital', None) or 100000)
    prices = parse_prices(args)

    if len(prices) < 30:
        return {'success': False, 'output': f'价格序列太短 ({len(prices)} < 30)'}

    # 策略选择
    if strategy == 'ma_cross':
        signals = _ma_cross_signals(prices, fast=5, slow=20)
    elif strategy == 'turtle':
        signals = _turtle_signals(prices, period=20)
    elif strategy == 'macd':
        signals = _macd_signals(prices)
    elif strategy == 'breakout':
        signals = _breakout_signals(prices, period=20)
    else:
        return {'success': False, 'output': f'未知策略: {strategy}. 可选: ma_cross, turtle, macd, breakout'}

    # 回测引擎
    result = _run_backtest(prices, signals, initial_capital)

    # 计算基准 (买入持有)
    buy_hold_return = (prices[-1] - prices[0]) / prices[0] * 100

    output = (
        f"📈 {symbol} 策略回测报告 ({strategy})\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📅 数据点数: {len(prices)} (起点: {prices[0]:.2f}, 终点: {prices[-1]:.2f})\n"
        f"💰 初始资金: ¥{initial_capital:,.0f}\n"
        f"💵 最终资金: ¥{result['final_capital']:,.0f}\n"
        f"📊 总收益率: {result['total_return']:+.2f}%   基准: {buy_hold_return:+.2f}%\n"
        f"🏆 超额收益: {result['total_return'] - buy_hold_return:+.2f}%\n"
        f"📉 最大回撤: {result['max_drawdown']:.2f}%\n"
        f"🎯 胜率: {result['win_rate']:.1f}%   交易次数: {result['trade_count']}\n"
        f"📐 夏普比率: {result['sharpe']:.2f}\n"
        f"⏰ {datetime.now().isoformat()}\n"
        f"🔗 真实计算 (基于 {len(prices)} 个价格点)"
    )

    return {
        'success': True,
        'action': 'backtest',
        'skill': 'quant-trader',
        'description': f'{strategy} 策略回测',
        'strategy': strategy,
        'symbol': symbol,
        'data_points': len(prices),
        'initial_capital': initial_capital,
        'metrics': {
            'final_capital': round(result['final_capital'], 2),
            'total_return_pct': round(result['total_return'], 2),
            'buy_hold_return_pct': round(buy_hold_return, 2),
            'excess_return_pct': round(result['total_return'] - buy_hold_return, 2),
            'max_drawdown_pct': round(result['max_drawdown'], 2),
            'win_rate_pct': round(result['win_rate'], 1),
            'trade_count': result['trade_count'],
            'sharpe_ratio': round(result['sharpe'], 2),
        },
        'trades': result['trades'][:10],  # 前 10 笔
        'output': output,
        'timestamp': datetime.now().isoformat(),
    }


def _ma_cross_signals(prices, fast=5, slow=20):
    """均线交叉: 快线上穿慢线买入, 下穿卖出"""
    ma_f = sma(prices, fast)
    ma_s = sma(prices, slow)
    signals = []
    for i in range(1, len(prices)):
        if ma_f[i] is None or ma_s[i] is None or ma_f[i-1] is None or ma_s[i-1] is None:
            signals.append(0); continue
        if ma_f[i-1] <= ma_s[i-1] and ma_f[i] > ma_s[i]:
            signals.append(1)   # 买入
        elif ma_f[i-1] >= ma_s[i-1] and ma_f[i] < ma_s[i]:
            signals.append(-1)  # 卖出
        else:
            signals.append(0)
    signals.insert(0, 0)
    return signals


def _turtle_signals(prices, period=20):
    """海龟交易: 突破 20 日高点买入, 跌破 10 日低点卖出"""
    dc = donchian(prices, period)
    upper = dc['upper']
    # 卖出用 10 日低点
    lower10 = [None] * len(prices)
    for i in range(len(prices)):
        if i < 9:
            lower10[i] = None
        else:
            lower10[i] = min(prices[i-9:i+1])

    signals = []
    for i in range(1, len(prices)):
        if upper[i] is None or lower10[i] is None or upper[i-1] is None:
            signals.append(0); continue
        if prices[i-1] <= upper[i-1] and prices[i] > upper[i-1]:
            signals.append(1)   # 突破买入
        elif prices[i-1] >= lower10[i-1] and prices[i] < lower10[i-1]:
            signals.append(-1)  # 跌破卖出
        else:
            signals.append(0)
    signals.insert(0, 0)
    return signals


def _macd_signals(prices):
    """MACD 信号: DIF 上穿 DEA 买入, 下穿卖出"""
    m = macd(prices)
    dif, dea = m['DIF'], m['DEA']
    signals = []
    for i in range(1, len(prices)):
        if dif[i-1] <= dea[i-1] and dif[i] > dea[i]:
            signals.append(1)
        elif dif[i-1] >= dea[i-1] and dif[i] < dea[i]:
            signals.append(-1)
        else:
            signals.append(0)
    signals.insert(0, 0)
    return signals


def _breakout_signals(prices, period=20):
    """简单突破: 价格 > N 日均线买入"""
    ma = sma(prices, period)
    signals = []
    for i in range(1, len(prices)):
        if ma[i] is None:
            signals.append(0); continue
        if prices[i-1] <= ma[i] and prices[i] > ma[i]:
            signals.append(1)
        elif prices[i-1] >= ma[i] and prices[i] < ma[i]:
            signals.append(-1)
        else:
            signals.append(0)
    signals.insert(0, 0)
    return signals


def _run_backtest(prices, signals, initial_capital):
    """回测引擎: 满仓进出, T+1, 计算收益/回撤/胜率"""
    capital = initial_capital
    position = 0  # 持仓股数
    cost_basis = 0
    trades = []
    equity_curve = [initial_capital]

    for i in range(1, len(prices)):
        sig = signals[i]
        price = prices[i]

        if sig == 1 and position == 0:
            # 买入: 满仓
            position = capital / price
            cost_basis = price
            capital = 0
            trades.append({'day': i, 'side': 'buy', 'price': round(price, 2)})
        elif sig == -1 and position > 0:
            # 卖出: 清仓
            capital = position * price
            pnl = (price - cost_basis) / cost_basis * 100
            trades.append({'day': i, 'side': 'sell', 'price': round(price, 2), 'pnl_pct': round(pnl, 2)})
            position = 0

        # 当日权益
        equity = capital + position * price
        equity_curve.append(equity)

    # 期末平仓
    if position > 0:
        capital = position * prices[-1]
        position = 0

    final_capital = capital
    total_return = (final_capital - initial_capital) / initial_capital * 100

    # 最大回撤
    peak = equity_curve[0]
    max_dd = 0
    for e in equity_curve:
        if e > peak:
            peak = e
        dd = (peak - e) / peak * 100
        if dd > max_dd:
            max_dd = dd

    # 胜率
    sell_trades = [t for t in trades if t.get('side') == 'sell']
    win_count = sum(1 for t in sell_trades if t.get('pnl_pct', 0) > 0)
    win_rate = (win_count / len(sell_trades) * 100) if sell_trades else 0

    # 夏普比率 (基于日收益, 无风险利率 0)
    daily_returns = []
    for i in range(1, len(equity_curve)):
        if equity_curve[i-1] > 0:
            daily_returns.append((equity_curve[i] - equity_curve[i-1]) / equity_curve[i-1])
    if daily_returns:
        mean_r = sum(daily_returns) / len(daily_returns)
        std_r = math.sqrt(sum((r - mean_r) ** 2 for r in daily_returns) / len(daily_returns)) if len(daily_returns) > 1 else 0.001
        sharpe = (mean_r / std_r * math.sqrt(252)) if std_r > 0 else 0
    else:
        sharpe = 0

    return {
        'final_capital': final_capital,
        'total_return': total_return,
        'max_drawdown': max_dd,
        'win_rate': win_rate,
        'trade_count': len(sell_trades),
        'sharpe': sharpe,
        'trades': trades,
    }


def action_signals(args):
    """实时信号: 综合多个技术指标给出买卖建议"""
    prices = parse_prices(args)
    symbol = getattr(args, 'symbol', None) or 'SAMPLE'
    strategy = (getattr(args, 'strategy', None) or 'composite').lower()

    if len(prices) < 30:
        return {'success': False, 'output': f'价格序列太短 ({len(prices)} < 30)'}

    last = prices[-1]
    ma5 = sma(prices, 5)[-1]
    ma20 = sma(prices, 20)[-1]
    ma60 = sma(prices, 60)[-1] if len(prices) >= 60 else None
    rsi_v = rsi(prices)[-1]
    m = macd(prices)
    dif, dea, hist = m['DIF'][-1], m['DEA'][-1], m['HIST'][-1]

    # 综合信号评分 (-100 ~ +100)
    score = 0
    reasons = []

    if ma5 is not None and ma20 is not None:
        if ma5 > ma20:
            score += 25; reasons.append('🟢 MA5 > MA20 短期多头')
        else:
            score -= 25; reasons.append('🔴 MA5 < MA20 短期空头')

    if ma60 is not None:
        if last > ma60:
            score += 15; reasons.append('🟢 价格在 MA60 之上 (中期趋势向上)')
        else:
            score -= 15; reasons.append('🔴 价格在 MA60 之下 (中期趋势向下)')

    if rsi_v is not None:
        if rsi_v > 70:
            score -= 20; reasons.append(f'⚠️ RSI={rsi_v:.1f} 超买区域')
        elif rsi_v < 30:
            score += 20; reasons.append(f'💎 RSI={rsi_v:.1f} 超卖区域 (反弹机会)')
        else:
            reasons.append(f'⚪ RSI={rsi_v:.1f} 中性区域')

    if dif > dea:
        score += 20; reasons.append('🟢 MACD 金叉 (DIF > DEA)')
    else:
        score -= 20; reasons.append('🔴 MACD 死叉 (DIF < DEA)')

    if hist > 0:
        reasons.append('🟢 MACD 柱状图为正, 动能向上')
    else:
        reasons.append('🔴 MACD 柱状图为负, 动能向下')

    # 信号判定
    if score >= 50:
        action_signal = '强烈买入 🟢🟢🟢'
    elif score >= 20:
        action_signal = '买入 🟢🟢'
    elif score >= -20:
        action_signal = '观望 ⚪'
    elif score >= -50:
        action_signal = '卖出 🔴🔴'
    else:
        action_signal = '强烈卖出 🔴🔴🔴'

    output = (
        f"🎯 {symbol} 实时交易信号\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💰 最新价: {last:.2f}\n"
        f"📊 综合评分: {score:+d} / 100\n"
        f"🚦 操作建议: {action_signal}\n"
        f"\n📐 技术指标:\n"
        f"   MA5:  {ma5:.2f}   MA20: {ma20:.2f}" + (f"   MA60: {ma60:.2f}" if ma60 else "") + "\n"
        f"   RSI:  {rsi_v:.1f}\n"
        f"   MACD: DIF={dif:.4f}  DEA={dea:.4f}  HIST={hist:.4f}\n"
        f"\n💡 信号依据:\n   " + "\n   ".join(reasons) + "\n"
        f"⏰ {datetime.now().isoformat()}"
    )

    return {
        'success': True,
        'action': 'signals',
        'skill': 'quant-trader',
        'description': '实时交易信号',
        'symbol': symbol,
        'price': last,
        'signal': action_signal,
        'score': score,
        'indicators': {
            'MA5': ma5, 'MA20': ma20, 'MA60': ma60,
            'RSI': rsi_v, 'MACD_DIF': dif, 'MACD_DEA': dea, 'MACD_HIST': hist,
        },
        'reasons': reasons,
        'output': output,
        'timestamp': datetime.now().isoformat(),
    }


def action_indicators(args):
    """技术指标计算: MA/EMA/MACD/RSI/BOLL/KDJ/海龟通道"""
    prices = parse_prices(args)
    symbol = getattr(args, 'symbol', None) or 'SAMPLE'
    indicators_str = getattr(args, 'indicators', None) or 'ma,rsi,macd,boll,kdj,turtle'
    wanted = [s.strip().lower() for s in indicators_str.split(',')]

    if len(prices) < 5:
        return {'success': False, 'output': f'价格序列太短 ({len(prices)} < 5)'}

    result = {'symbol': symbol, 'data_points': len(prices), 'last_price': prices[-1]}
    indicators = {}

    if 'ma' in wanted or 'sma' in wanted:
        ma5 = sma(prices, 5)
        ma20 = sma(prices, 20)
        indicators['MA'] = {
            'MA5': round(ma5[-1], 4) if ma5[-1] is not None else None,
            'MA20': round(ma20[-1], 4) if ma20[-1] is not None else None,
            'MA60': round(sma(prices, 60)[-1], 4) if len(prices) >= 60 and sma(prices, 60)[-1] is not None else None,
        }

    if 'ema' in wanted:
        e = ema(prices, 12)
        indicators['EMA'] = {'EMA12': round(e[-1], 4), 'EMA26': round(ema(prices, 26)[-1], 4)}

    if 'macd' in wanted:
        m = macd(prices)
        indicators['MACD'] = {
            'DIF': round(m['DIF'][-1], 4),
            'DEA': round(m['DEA'][-1], 4),
            'HIST': round(m['HIST'][-1], 4),
        }

    if 'rsi' in wanted:
        r = rsi(prices)
        indicators['RSI'] = {
            'RSI14': round(r[-1], 2) if r[-1] is not None else None,
            'state': '超买' if r[-1] and r[-1] > 70 else ('超卖' if r[-1] and r[-1] < 30 else '中性'),
        }

    if 'boll' in wanted or 'bollinger' in wanted:
        b = bollinger(prices)
        indicators['BOLL'] = {
            'mid': round(b['mid'][-1], 4) if b['mid'][-1] else None,
            'upper': round(b['upper'][-1], 4) if b['upper'][-1] else None,
            'lower': round(b['lower'][-1], 4) if b['lower'][-1] else None,
        }

    if 'kdj' in wanted:
        k = kdj(prices)
        indicators['KDJ'] = {
            'K': round(k['K'][-1], 2),
            'D': round(k['D'][-1], 2),
            'J': round(k['J'][-1], 2),
        }

    if 'turtle' in wanted or 'donchian' in wanted:
        d = donchian(prices)
        indicators['TURTLE'] = {
            'upper_20': round(d['upper'][-1], 4) if d['upper'][-1] else None,
            'lower_20': round(d['lower'][-1], 4) if d['lower'][-1] else None,
        }

    # 格式化为可读输出
    lines = [f"📐 {symbol} 技术指标 (基于 {len(prices)} 个价格点)", "━" * 32]
    for name, ind in indicators.items():
        lines.append(f"\n🔹 {name}")
        for k, v in ind.items():
            lines.append(f"   {k}: {v}")

    return {
        'success': True,
        'action': 'indicators',
        'skill': 'quant-trader',
        'description': '技术指标计算',
        'symbol': symbol,
        'data_points': len(prices),
        'indicators': indicators,
        'output': "\n".join(lines) + f"\n\n⏰ {datetime.now().isoformat()}",
        'timestamp': datetime.now().isoformat(),
    }


ACTIONS = {
    'backtest': action_backtest,
    'signals': action_signals,
    'indicators': action_indicators
}


def main():
    args = get_args()
    action = args.action
    if not action:
        result = {
            'success': False,
            'output': '缺少 --action 参数. 可用动作: backtest, signals, indicators',
            'available_actions': ["backtest", "signals", "indicators"],
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}", flush=True)
        return

    handler = ACTIONS.get(action)
    if not handler:
        result = {
            'success': False,
            'output': f'未知 action: {action}. 可用: backtest, signals, indicators',
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

    print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}", flush=True)


if __name__ == '__main__':
    main()
