/**
 * VoiceSelector — TTS 音色选择器
 * 支持 Agnes/Azure TTS 40+ 音色
 */
import React, { useState, useEffect } from 'react';
import { Select, Button, Space, Tag, message } from 'antd';
import { SoundOutlined, PlayCircleOutlined } from '@ant-design/icons';

interface Voice {
  id: string;
  name: string;
  gender: string;
  provider: string;
  locale?: string;
  style?: string;
}

const DEFAULT_VOICES: Voice[] = [
  // MIMO 音色（小米商业TTS - 推荐）
  { id: 'mimo-zhinv', name: '米女', gender: 'female', provider: 'mimo', locale: 'zh-CN', style: '温柔知性女声' },
  { id: 'mimo-zhinan', name: '米男', gender: 'male', provider: 'mimo', locale: 'zh-CN', style: '成熟稳重男声' },
  { id: 'mimo-yujie', name: '御姐', gender: 'female', provider: 'mimo', locale: 'zh-CN', style: '成熟魅力女声' },
  { id: 'mimo-qingnian', name: '青年', gender: 'male', provider: 'mimo', locale: 'zh-CN', style: '阳光活力男声' },
  { id: 'mimo-shaonv', name: '少女', gender: 'female', provider: 'mimo', locale: 'zh-CN', style: '甜美可爱女声' },
  { id: 'mimo-dianshang', name: '电商', gender: 'female', provider: 'mimo', locale: 'zh-CN', style: '专业电商主播声' },
  // Agnes 音色
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: 'female', provider: 'agnes', locale: 'zh-CN', style: 'general' },
  { id: 'zh-CN-YunxiNeural', name: '云希', gender: 'male', provider: 'agnes', locale: 'zh-CN', style: 'general' },
  { id: 'zh-CN-YunjianNeural', name: '云健', gender: 'male', provider: 'agnes', locale: 'zh-CN', style: 'news' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', gender: 'female', provider: 'agnes', locale: 'zh-CN', style: 'gentle' },
  { id: 'zh-CN-YunyangNeural', name: '云扬', gender: 'male', provider: 'agnes', locale: 'zh-CN', style: 'professional' },
  { id: 'zh-CN-XiaochenNeural', name: '晓辰', gender: 'female', provider: 'agnes', locale: 'zh-CN', style: 'lively' },
  // 其他中文
  { id: 'zh-CN-XiaohanNeural', name: '晓涵', gender: 'female', provider: 'agnes', locale: 'zh-CN' },
  { id: 'zh-CN-XiaomengNeural', name: '晓梦', gender: 'female', provider: 'agnes', locale: 'zh-CN' },
  { id: 'zh-CN-YunfengNeural', name: '云枫', gender: 'male', provider: 'agnes', locale: 'zh-CN' },
  { id: 'zh-CN-YunhaoNeural', name: '云皓', gender: 'male', provider: 'agnes', locale: 'zh-CN' },
  // 方言
  { id: 'zh-HK-HiuMaanNeural', name: '晓曼(粤语)', gender: 'female', provider: 'agnes', locale: 'zh-HK' },
  { id: 'zh-HK-WanLungNeural', name: '云龙(粤语)', gender: 'male', provider: 'agnes', locale: 'zh-HK' },
  { id: 'zh-TW-HsiaoChenNeural', name: '晓臻(台湾)', gender: 'female', provider: 'agnes', locale: 'zh-TW' },
  { id: 'zh-TW-YunJheNeural', name: '云哲(台湾)', gender: 'male', provider: 'agnes', locale: 'zh-TW' },
  // 外语
  { id: 'en-US-AriaNeural', name: 'Aria (EN)', gender: 'female', provider: 'agnes', locale: 'en-US' },
  { id: 'en-US-GuyNeural', name: 'Guy (EN)', gender: 'male', provider: 'agnes', locale: 'en-US' },
  { id: 'ja-JP-NanamiNeural', name: '七海 (JP)', gender: 'female', provider: 'agnes', locale: 'ja-JP' },
  { id: 'ko-KR-SunHiNeural', name: '善熙 (KR)', gender: 'female', provider: 'agnes', locale: 'ko-KR' },
];

const TEST_TEXT = '你好，我是你的 AI 助手，很高兴为你服务。';

export const VoiceSelector: React.FC = () => {
  const [voices, setVoices] = useState<Voice[]>(DEFAULT_VOICES);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return localStorage.getItem('agentai.tts.voice') || 'mimo-zhinv';
  });
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  // 从后端获取音色列表
  useEffect(() => {
    fetchVoices();
  }, []);

  const fetchVoices = async () => {
    try {
      const resp = await fetch('/v1/tts/voices');
      if (resp.ok) {
        const data = await resp.json();
        if (data.voices && data.voices.length > 0) {
          // 过滤 Agnes 音色
          const agnesVoices = data.voices.filter((v: Voice) => v.provider === 'agnes');
          if (agnesVoices.length > 0) {
            setVoices(agnesVoices);
          }
        }
      }
    } catch (err) {
      console.warn('获取音色列表失败，使用默认列表:', err);
    }
  };

  const handleVoiceChange = (voiceId: string) => {
    setSelectedVoice(voiceId);
    localStorage.setItem('agentai.tts.voice', voiceId);
    message.success('音色已保存');
  };

  // 根据音色ID获取provider
  const getProvider = (voiceId: string): string => {
    if (voiceId.startsWith('mimo-')) return 'mimo';
    if (voiceId.includes('Neural')) return 'agnes';
    return 'agnes';
  };

  const testVoice = async () => {
    if (playing) return;
    
    setPlaying(true);
    try {
      const provider = getProvider(selectedVoice);
      const resp = await fetch('/v1/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: TEST_TEXT,
          voice: selectedVoice,
          provider,
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const contentType = resp.headers.get('Content-Type') || '';
      
      if (contentType.includes('json')) {
        const data = await resp.json();
        if (data.fallback === 'browser-api') {
          // 使用浏览器 TTS 作为 fallback
          speakWithBrowser(TEST_TEXT, selectedVoice);
          return;
        }
        throw new Error(data.note || 'TTS failed');
      }

      // 播放音频
      const audioBlob = await resp.blob();
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPlaying(false);
      };
      
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setPlaying(false);
        message.error('音频播放失败');
      };
      
      await audio.play();
    } catch (err: any) {
      console.error('测试音色失败:', err);
      message.error(`测试失败: ${err.message}`);
      // fallback 到浏览器 TTS
      speakWithBrowser(TEST_TEXT, selectedVoice);
    } finally {
      setPlaying(false);
    }
  };

  // 浏览器 TTS fallback
  const speakWithBrowser = (text: string, voiceId: string) => {
    if (!window.speechSynthesis) {
      message.error('浏览器不支持语音合成');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    
    // 尝试匹配音色
    const voices = window.speechSynthesis.getVoices();
    const matched = voices.find(v => 
      v.name.includes('Xiaoxiao') || v.name.includes('Chinese')
    );
    if (matched) utterance.voice = matched;
    
    utterance.onend = () => setPlaying(false);
    utterance.onerror = () => setPlaying(false);
    
    window.speechSynthesis.speak(utterance);
  };

  // 分组显示
  const groupedVoices = {
    '推荐': voices.filter(v => ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-YunyangNeural', 'zh-CN-XiaochenNeural'].includes(v.id)),
    '中文女声': voices.filter(v => v.locale === 'zh-CN' && v.gender === 'female' && !groupedVoices['推荐']?.find(r => r.id === v.id)),
    '中文男声': voices.filter(v => v.locale === 'zh-CN' && v.gender === 'male' && !groupedVoices['推荐']?.find(r => r.id === v.id)),
    '方言': voices.filter(v => v.locale?.startsWith('zh-') && v.locale !== 'zh-CN'),
    '外语': voices.filter(v => !v.locale?.startsWith('zh-')),
  };

  const selectedVoiceInfo = voices.find(v => v.id === selectedVoice);

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select
        value={selectedVoice}
        onChange={handleVoiceChange}
        style={{ width: '100%' }}
        placeholder="选择音色"
        optionLabelProp="label"
        dropdownMatchSelectWidth={false}
      >
        {Object.entries(groupedVoices).map(([group, groupVoices]) => (
          groupVoices.length > 0 && (
            <Select.OptGroup key={group} label={group}>
              {groupVoices.map(voice => (
                <Select.Option 
                  key={voice.id} 
                  value={voice.id}
                  label={`${voice.name} ${voice.style ? `(${getStyleLabel(voice.style)})` : ''}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{voice.name}</span>
                    <Tag  color={voice.gender === 'female' ? 'pink' : 'blue'}>
                      {voice.gender === 'female' ? '女' : '男'}
                    </Tag>
                    {voice.style && (
                      <Tag  color="default">{getStyleLabel(voice.style)}</Tag>
                    )}
                  </div>
                </Select.Option>
              ))}
            </Select.OptGroup>
          )
        ))}
      </Select>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          icon={<PlayCircleOutlined />}
          onClick={testVoice}
          loading={playing}
          
          type="primary"
        >
          试听
        </Button>
        
        {selectedVoiceInfo && (
          <span style={{ fontSize: 12, color: '#888' }}>
            当前: {selectedVoiceInfo.name} 
            {selectedVoiceInfo.style && `(${getStyleLabel(selectedVoiceInfo.style)})`}
          </span>
        )}
      </div>
    </Space>
  );
};

function getStyleLabel(style: string): string {
  const labels: Record<string, string> = {
    'general': '通用',
    'news': '新闻',
    'gentle': '温柔',
    'professional': '专业',
    'lively': '活泼',
  };
  return labels[style] || style;
}

export default VoiceSelector;
