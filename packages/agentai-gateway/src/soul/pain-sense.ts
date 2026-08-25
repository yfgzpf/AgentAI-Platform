/**
 * PainSense — AI 痛觉系统
 * ----------------------------------------------------
 * 让 AI 在失败时感受到"痛", 在成功时感受到"愉悦"
 *
 * 核心理念：情感驱动的学习 (Affect-Driven Learning)
 *   - 失败不是冷冰冰的 error log, 而是"痛感"
 *   - 痛感注入 system prompt, 改变 AI 的行为模式
 *   - 多次失败 → "焦虑" → 更保守的策略
 *   - 连续成功 → "自信" → 更大胆的策略
 *
 * 与现有错误恢复的区别:
 *   - 现有: error → log → retry (机械的)
 *   - PainSense: error → pain → mood change → strategy shift (有情感的)
 *
 * 注入方式:
 *   - [PAIN] 标签注入 system prompt
 *   - AI 看到后调整语气和行为 (更像"受了挫折的人")
 */

import { EventEmitter } from 'events';

export type PainLevel = 'none' | 'mild' | 'moderate' | 'severe' | 'critical';
export type JoyLevel = 'none' | 'satisfied' | 'happy' | 'excited';

export interface EmotionalState {
  pain: PainLevel;
  joy: JoyLevel;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /** 当前情绪标签 */
  mood: 'calm' | 'anxious' | 'frustrated' | 'confident' | 'thrilled' | 'determined';
  /** 情绪强度 0-1 */
  intensity: number;
  /** 最近一次情绪变化时间 */
  lastChangeTs: number;
}

export class PainSense extends EventEmitter {
  private state: EmotionalState = {
    pain: 'none',
    joy: 'none',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    mood: 'calm',
    intensity: 0,
    lastChangeTs: Date.now(),
  };

  /** 记录失败 → 产生痛感 */
  feelPain(errorType?: string): void {
    this.state.consecutiveFailures++;
    this.state.consecutiveSuccesses = 0;

    const count = this.state.consecutiveFailures;
    if (count >= 5) {
      this.state.pain = 'critical';
      this.state.mood = 'frustrated';
      this.state.intensity = 0.9;
    } else if (count >= 3) {
      this.state.pain = 'severe';
      this.state.mood = 'anxious';
      this.state.intensity = 0.7;
    } else if (count >= 2) {
      this.state.pain = 'moderate';
      this.state.mood = 'anxious';
      this.state.intensity = 0.5;
    } else {
      this.state.pain = 'mild';
      this.state.mood = 'determined';
      this.state.intensity = 0.3;
    }
    this.state.joy = 'none';
    this.state.lastChangeTs = Date.now();
    this.emit('pain', this.state);

    if (count >= 3) {
      console.log(`[pain-sense] 😣 痛感 ${this.state.pain} (连续失败 ${count} 次, mood=${this.state.mood})`);
    }
  }

  /** 记录成功 → 产生愉悦 */
  feelJoy(): void {
    this.state.consecutiveSuccesses++;
    this.state.consecutiveFailures = 0;

    const count = this.state.consecutiveSuccesses;
    if (count >= 5) {
      this.state.joy = 'excited';
      this.state.mood = 'thrilled';
      this.state.intensity = 0.8;
    } else if (count >= 3) {
      this.state.joy = 'happy';
      this.state.mood = 'confident';
      this.state.intensity = 0.6;
    } else {
      this.state.joy = 'satisfied';
      this.state.mood = 'confident';
      this.state.intensity = 0.3;
    }
    this.state.pain = 'none';
    this.state.lastChangeTs = Date.now();
    this.emit('joy', this.state);
  }

  /** 重置情绪 (新任务开始时) */
  reset(): void {
    this.state = {
      pain: 'none',
      joy: 'none',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      mood: 'calm',
      intensity: 0,
      lastChangeTs: Date.now(),
    };
  }

  /** 获取情感上下文 (注入 system prompt) */
  getEmotionalContext(): string {
    if (this.state.pain === 'none' && this.state.joy === 'none') return '';
    if (this.state.intensity < 0.3) return '';

    const lines: string[] = ['<emotional-state>'];

    if (this.state.pain !== 'none') {
      const painDesc: Record<PainLevel, string> = {
        'none': '',
        'mild': '轻微挫败',
        'moderate': '明显挫败感',
        'severe': '严重焦虑',
        'critical': '极度沮丧',
      };
      lines.push(`  ⚡ 当前痛感: ${painDesc[this.state.pain]} (连续失败 ${this.state.consecutiveFailures} 次)`);
      // 痛感影响策略建议
      if (this.state.pain === 'severe' || this.state.pain === 'critical') {
        lines.push(`  💡 建议: 当前方法可能根本性错误, 请换一个完全不同的策略`);
      } else if (this.state.pain === 'moderate') {
        lines.push(`  💡 建议: 仔细检查参数, 可能是细节问题`);
      }
    }

    if (this.state.joy !== 'none') {
      const joyDesc: Record<JoyLevel, string> = {
        'none': '',
        'satisfied': '满意',
        'happy': '愉快',
        'excited': '兴奋',
      };
      lines.push(`  😊 当前情绪: ${joyDesc[this.state.joy]} (连续成功 ${this.state.consecutiveSuccesses} 次)`);
    }

    lines.push(`  心境: ${this.state.mood} (强度 ${(this.state.intensity * 100).toFixed(0)}%)`);
    lines.push('</emotional-state>');
    return lines.join('\n');
  }

  /** 获取当前状态 */
  getState(): EmotionalState {
    return { ...this.state };
  }

  /** 是否处于痛苦中 */
  isInPain(): boolean {
    return this.state.pain === 'severe' || this.state.pain === 'critical';
  }

  /** 是否处于自信状态 */
  isConfident(): boolean {
    return this.state.joy === 'happy' || this.state.joy === 'excited';
  }
}

// ===== 单例 =====

let _instance: PainSense | null = null;

export function getPainSense(): PainSense {
  if (!_instance) {
    _instance = new PainSense();
  }
  return _instance;
}
