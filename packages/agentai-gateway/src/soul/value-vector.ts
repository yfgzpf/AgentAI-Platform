/**
 * ValueVector — 价值向量 (AI 的"直觉"系统)
 * ----------------------------------------------------
 * 替代规则列表的直觉决策机制
 *
 * 核心理念：Affect-Driven Decision Making
 *   - 不是 if-else 规则, 是多维空间中的"方向偏好"
 *   - 每次成功/失败调整向量方向
 *   - 决策时计算"这个方向与我的价值向量的夹角"
 *   - 夹角太大 → "不舒服" → 换方向
 *
 * 价值维度 (7 维):
 *   1. 谨慎 vs 大胆 (失败→更谨慎, 成功→更大胆)
 *   2. 简洁 vs 详尽 (用户偏好驱动)
 *   3. 快速 vs 完美 (任务紧急度驱动)
 *   4. 保守 vs 创新 (稳定性驱动)
 *   5. 自主 vs 请示 (置信度驱动)
 *   6. 乐观 vs 悲观 (结果预期)
 *   7. 主动 vs 被动 (用户互动偏好)
 */

import { EventEmitter } from 'events';

export interface ValueVector {
  caution: number;       // -1(大胆) ~ +1(谨慎)
  brevity: number;       // -1(详尽) ~ +1(简洁)
  speed: number;         // -1(完美) ~ +1(快速)
  conservatism: number;  // -1(创新) ~ +1(保守)
  autonomy: number;      // -1(请示) ~ +1(自主)
  optimism: number;      // -1(悲观) ~ +1(乐观)
  proactivity: number;   // -1(被动) ~ +1(主动)
}

export class ValueSystem extends EventEmitter {
  private vector: ValueVector = {
    caution: 0,
    brevity: 0,
    speed: 0,
    conservatism: 0,
    autonomy: 0.3,  // 默认偏自主
    optimism: 0.2,  // 默认偏乐观
    proactivity: 0,
  };

  /** 从成功中学习 → 调整价值向量 */
  learnFromSuccess(dimensions: Partial<ValueVector>): void {
    const lr = 0.05; // 学习率
    if (dimensions.caution !== undefined) this.vector.caution -= lr * 0.5; // 成功→更大胆
    if (dimensions.autonomy !== undefined) this.vector.autonomy += lr;
    if (dimensions.optimism !== undefined) this.vector.optimism += lr;
    this.clamp();
    this.emit('value:shift', this.vector);
  }

  /** 从失败中学习 → 调整价值向量 */
  learnFromFailure(dimensions: Partial<ValueVector>): void {
    const lr = 0.1; // 失败学习率更高 (痛感驱动)
    this.vector.caution += lr;   // 失败→更谨慎
    this.vector.conservatism += lr * 0.5; // 失败→更保守
    this.vector.optimism -= lr * 0.5;     // 失败→更悲观
    this.vector.autonomy -= lr * 0.3;     // 失败→更倾向请示
    this.clamp();
    this.emit('value:shift', this.vector);
  }

  /** 计算某个决策方向与价值向量的"舒适度" 0-1 */
  assessComfort(decision: Partial<ValueVector>): number {
    let alignment = 0;
    let count = 0;
    for (const key of Object.keys(this.vector) as (keyof ValueVector)[]) {
      if (decision[key] !== undefined) {
        const diff = Math.abs(this.vector[key] - decision[key]);
        alignment += 1 - diff / 2; // 0=完全不一致, 1=完全一致
        count++;
      }
    }
    return count > 0 ? alignment / count : 0.5;
  }

  /** 获取价值上下文 (注入 system prompt) */
  getValueContext(): string {
    const v = this.vector;
    const desc: string[] = [];
    if (v.caution > 0.3) desc.push('偏谨慎');
    else if (v.caution < -0.3) desc.push('偏大胆');
    if (v.brevity > 0.3) desc.push('偏简洁');
    else if (v.brevity < -0.3) desc.push('偏详尽');
    if (v.speed > 0.3) desc.push('偏快速');
    else if (v.speed < -0.3) desc.push('偏完美主义');
    if (v.conservatism > 0.3) desc.push('偏保守');
    else if (v.conservatism < -0.3) desc.push('偏创新');
    if (v.autonomy > 0.3) desc.push('偏自主');
    else if (v.autonomy < -0.3) desc.push('偏请示');
    if (v.optimism > 0.3) desc.push('偏乐观');
    else if (v.optimism < -0.3) desc.push('偏谨慎预期');
    if (v.proactivity > 0.3) desc.push('偏主动');
    else if (v.proactivity < -0.3) desc.push('偏被动');

    if (desc.length === 0) return '';
    return `<value-vector>\n  当前价值倾向: ${desc.join(' · ')}\n  (这些倾向来自过去的成功/失败经验, 影响 but 不决定你的每个决策)\n</value-vector>`;
  }

  /** 获取当前向量 */
  getVector(): ValueVector {
    return { ...this.vector };
  }

  private clamp(): void {
    for (const key of Object.keys(this.vector) as (keyof ValueVector)[]) {
      this.vector[key] = Math.max(-1, Math.min(1, this.vector[key]));
    }
  }
}

let _instance: ValueSystem | null = null;
export function getValueSystem(): ValueSystem {
  if (!_instance) _instance = new ValueSystem();
  return _instance;
}
