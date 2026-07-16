/**
 * CaptchaHandler — 人机接力验证码处理
 * ----------------------------------------------------------------
 * 学自: BrowserAct 三层架构的第三层（人机接力层）
 * 
 * 核心思路:
 *   - 检测页面中的验证码元素
 *   - 暂停自动化, 通知用户手动处理
 *   - 用户处理后自动恢复
 * 
 * 支持的验证码类型:
 *   1. 短信验证码 (SMS OTP) — 输入 6 位数字
 *   2. 滑块验证码 — 拖动滑块到指定位置
 *   3. 点选验证码 — 点击指定文字/图标
 *   4. 图形验证码 (CAPTCHA) — 输入图片中的文字
 *   5. 人机验证 (Cloudflare/Geetest) — 需要人工介入
 */

export interface CaptchaInfo {
  type: 'sms' | 'slider' | 'click' | 'image' | 'cloudflare' | 'geetest' | 'unknown';
  description: string;
  /** 需要用户输入的值 */
  userInput?: string;
  /** 验证码元素定位信息 */
  elementInfo?: {
    selector?: string;
    text?: string;
    rect?: { x: number; y: number; width: number; height: number };
  };
}

export interface CaptchaHandlerCallbacks {
  /** 检测到验证码时调用 */
  onCaptchaDetected: (captcha: CaptchaInfo) => void;
  /** 用户输入验证码后调用 */
  onCaptchaResolved: (captchaType: string, userInput: string) => void;
}

export class CaptchaHandler {
  private callbacks: CaptchaHandlerCallbacks;
  private isPaused = false;
  private currentCaptcha: CaptchaInfo | null = null;
  private resolvePromise: { resolve: (value: string) => void; reject: (error: Error) => void } | null = null;

  constructor(callbacks: CaptchaHandlerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * 检测页面中是否存在验证码
   * 通过扫描页面 DOM 元素来判断
   */
  detectCaptcha(elements: Array<{ selector: string; text?: string; placeholder?: string; type?: string }>): CaptchaInfo | null {
    for (const el of elements) {
      const text = (el.text || '').toLowerCase();
      const placeholder = (el.placeholder || '').toLowerCase();
      const selector = (el.selector || '').toLowerCase();
      const type = (el.type || '').toLowerCase();

      // 短信验证码
      if (text.includes('短信') || text.includes('验证码') || placeholder.includes('sms') || placeholder.includes('otp')) {
        return {
          type: 'sms',
          description: '检测到短信验证码输入框, 请输入您收到的 6 位验证码',
          elementInfo: { selector: el.selector },
        };
      }

      // 滑块验证码
      if (text.includes('滑块') || text.includes('swipe') || text.includes('geetest') || selector.includes('slider') || selector.includes('drag')) {
        return {
          type: 'slider',
          description: '检测到滑块验证码, 请手动拖动滑块完成验证',
          elementInfo: { selector: el.selector },
        };
      }

      // 点选验证码
      if (text.includes('点选') || text.includes('click') || text.includes('point') || text.includes('顺序')) {
        return {
          type: 'click',
          description: '检测到点选验证码, 请按提示点击指定文字/图标',
          elementInfo: { selector: el.selector },
        };
      }

      // 图形验证码
      if (text.includes('图形验证码') || text.includes('captcha') || text.includes('recaptcha') || selector.includes('captcha')) {
        return {
          type: 'image',
          description: '检测到图形验证码, 请输入图片中的文字',
          elementInfo: { selector: el.selector },
        };
      }

      // Cloudflare 人机验证
      if (text.includes('cloudflare') || text.includes('checking') || text.includes('verifying') || selector.includes('cf-challenge')) {
        return {
          type: 'cloudflare',
          description: '检测到 Cloudflare 人机验证, 请完成验证后继续',
          elementInfo: { selector: el.selector },
        };
      }

      // 通用验证码检测
      if (/验证|captcha|security|robot|human/i.test(text) && /输入|框|field|input|code|number/i.test(selector)) {
        return {
          type: 'unknown',
          description: '检测到可能的验证码输入框, 请手动输入验证码',
          elementInfo: { selector: el.selector },
        };
      }
    }

    return null;
  }

  /**
   * 暂停自动化, 等待用户输入验证码
   * @returns 用户输入的验证码值
   */
  async waitForUserInput(): Promise<string> {
    this.isPaused = true;

    return new Promise<string>((resolve, reject) => {
      this.resolvePromise = { resolve, reject };
    });
  }

  /**
   * 处理用户输入的验证码
   */
  handleUserInput(captchaType: string, userInput: string): void {
    this.isPaused = false;
    this.currentCaptcha = null;

    if (this.resolvePromise) {
      this.resolvePromise.resolve(userInput);
      this.resolvePromise = null;
    }

    this.callbacks.onCaptchaResolved(captchaType, userInput);
  }

  /**
   * 标记验证码已处理（用于非暂停场景）
   */
  markResolved(captcha: CaptchaInfo, userInput: string): void {
    this.currentCaptcha = null;
    this.callbacks.onCaptchaResolved(captcha.type, userInput);
  }

  /**
   * 获取当前验证码信息
   */
  getCurrentCaptcha(): CaptchaInfo | null {
    return this.currentCaptcha;
  }

  /**
   * 是否正在等待用户输入
   */
  isWaiting(): boolean {
    return this.isPaused;
  }

  /**
   * 取消等待
   */
  cancel(): void {
    this.isPaused = false;
    this.currentCaptcha = null;
    if (this.resolvePromise) {
      this.resolvePromise.reject(new Error('验证码输入已取消'));
      this.resolvePromise = null;
    }
  }
}

/**
 * 从页面 HTML 中检测验证码的模式
 */
export function detectCaptchaFromHtml(html: string): CaptchaInfo | null {
  // 短信验证码
  if (/验证码|sms|otp|verification.code/i.test(html)) {
    return {
      type: 'sms',
      description: '页面中包含验证码相关元素, 可能需要手动输入',
    };
  }

  // Cloudflare
  if (/cloudflare|cf-challenge|checking.browser/i.test(html)) {
    return {
      type: 'cloudflare',
      description: '检测到 Cloudflare 人机验证, 需要人工介入',
    };
  }

  // Geetest
  if (/geetest|gt.*challenge/i.test(html)) {
    return {
      type: 'slider',
      description: '检测到极验 (Geetest) 验证码',
    };
  }

  return null;
}
