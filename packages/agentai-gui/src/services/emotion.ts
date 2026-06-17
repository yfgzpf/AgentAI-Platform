/**
 * Emotion Service — 情绪感知分析
 * 使用 LLM 分析文本中的情绪倾向
 * 支持: 积极 / 消极 / 中性 / 焦虑 / 愤怒 / 惊讶 / 悲伤
 */
export type EmotionType =
  | 'positive'    // 积极
  | 'negative'    // 消极
  | 'neutral'     // 中性
  | 'anxious'     // 焦虑
  | 'angry'       // 愤怒
  | 'surprised'   // 惊讶
  | 'sad'         // 悲伤
  | 'joyful'      // 愉快
  ;

export interface EmotionResult {
  emotion: EmotionType;
  /** 情绪强度 0–1 */
  intensity: number;
  /** 中文标签 */
  label: string;
  /** 表情符号 */
  emoji: string;
}

/* ===== 情绪映射 ===== */
const EMOTION_MAP: Record<EmotionType, { label: string; emoji: string }> = {
  positive:   { label: '积极',   emoji: '😊' },
  negative:   { label: '消极',   emoji: '😞' },
  neutral:    { label: '中性',   emoji: '😐' },
  anxious:    { label: '焦虑',   emoji: '😰' },
  angry:      { label: '愤怒',   emoji: '😠' },
  surprised:  { label: '惊讶',   emoji: '😮' },
  sad:        { label: '悲伤',   emoji: '😢' },
  joyful:     { label: '愉快',   emoji: '😄' },
};

/**
 * 分析文本情绪
 * 调用 LLM 进行情感分析
 */
export async function analyzeEmotion(text: string): Promise<EmotionResult> {
  if (!text.trim()) {
    return { emotion: 'neutral', intensity: 0, label: '中性', emoji: '😐' };
  }

  try {
    const resp = await fetch('/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `分析以下文本的情绪。只返回 JSON 格式（不要 markdown）：
{"emotion": "情绪类型", "intensity": 0~1}

情绪类型可选: positive, negative, neutral, anxious, angry, surprised, sad, joyful

文本："""${text.slice(0, 300)}"""`,
        stream: false,
        model: 'agentai',
        mode: 'auto',
        system: 'You are an emotion analysis expert. Output ONLY valid JSON without any markdown wrapping.',
        _internal: true, // 标记为内部请求, 不写入记忆
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const content = typeof data === 'object' ? (data.content || data.text || '') : data;

    // Parse JSON
    let jsonText = content;
    const m = content.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (m) jsonText = m[1];
    const parsed = JSON.parse(jsonText);

    const emotion = (parsed.emotion || 'neutral') as EmotionType;
    const intensity = Math.min(1, Math.max(0, parsed.intensity || 0.5));
    const info = EMOTION_MAP[emotion] || EMOTION_MAP.neutral;

    return { emotion, intensity, label: info.label, emoji: info.emoji };
  } catch {
    // Fallback: 简单规则分析
    return simpleAnalyze(text);
  }
}

/**
 * 快速启发式情绪分析 (不调LLM, 立即返回)
 * 用于在发送消息时同步注入情绪上下文
 */
export function analyzeEmotionQuick(text: string): EmotionResult {
  return simpleAnalyze(text);
}

/**
 * 简单规则分析 (作为 LLM 分析的 fallback)
 */
function simpleAnalyze(text: string): EmotionResult {
  const t = text.toLowerCase();

  // 积极词
  const positiveWords = ['谢谢', '感谢', '好', '棒', '厉害', '优秀', '喜欢', '开心', '谢谢', 'ok', 'great', 'good', 'nice', 'love', 'happy', 'wonderful', 'amazing'];
  const negativeWords = ['不好', '差', '烦', '讨厌', '糟糕', '难过', '伤心', '生气', '恨', 'bad', 'terrible', 'awful', 'hate', 'sad', 'angry', 'ugly'];
  const anxiousWords = ['担心', '害怕', '紧张', '焦虑', '不安', 'worried', 'scared', 'nervous', 'anxious', 'fear'];
  const angryWords = ['愤怒', '气死', '火大', '滚', 'angry', 'furious', 'mad', 'rage'];
  const sadWords = ['伤心', '难过', '哭', '悲伤', 'sad', 'cry', 'depressed', 'unhappy'];
  const surprisedWords = ['惊讶', '没想到', '居然', '竟然', 'surprised', 'shocked', 'wow', 'unbelievable'];
  const joyfulWords = ['开心', '快乐', '高兴', '兴奋', '真是太', 'joy', 'delighted', 'excited', 'thrilled'];

  let scores = { positive: 0, negative: 0, anxious: 0, angry: 0, sad: 0, surprised: 0, joyful: 0 };

  const count = (words: string[]) => words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);

  scores.positive = count(positiveWords);
  scores.negative = count(negativeWords);
  scores.anxious = count(anxiousWords);
  scores.angry = count(angryWords);
  scores.sad = count(sadWords);
  scores.surprised = count(surprisedWords);
  scores.joyful = count(joyfulWords);

  // 找最高分
  let maxEmotion: EmotionType = 'neutral';
  let maxScore = 0;
  for (const [key, val] of Object.entries(scores)) {
    if (val > maxScore) {
      maxScore = val;
      maxEmotion = key as EmotionType;
    }
  }

  if (maxScore === 0) {
    // 检查是否有感叹号/问号判断情绪
    if (text.includes('!') && text.includes('?')) {
      return { emotion: 'surprised', intensity: 0.4, label: '惊讶', emoji: '😮' };
    }
    return { emotion: 'neutral', intensity: 0.2, label: '中性', emoji: '😐' };
  }

  const intensity = Math.min(1, maxScore * 0.3);
  const info = EMOTION_MAP[maxEmotion] || EMOTION_MAP.neutral;
  return { emotion: maxEmotion, intensity, label: info.label, emoji: info.emoji };
}
