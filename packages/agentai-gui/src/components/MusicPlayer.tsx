/**
 * MusicPlayer — 音乐播放器组件
 * 支持: 播放/暂停、上一曲/下一曲、音量调节、本地文件、播放列表、背景音乐
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  PlayCircleOutlined, PauseCircleOutlined,
  StepForwardOutlined, StepBackwardOutlined,
  SoundOutlined, MenuOutlined, CloseOutlined,
  DeleteOutlined, UploadOutlined,
} from '@ant-design/icons';

/* ===== 曲目类型 ===== */
interface Track {
  id: string;
  name: string;
  url: string;
  duration: number;
  artist?: string;
}

/* ===== 预设免费音乐库 ===== */
/**
 * 免费音乐库
 * 优先使用 SoundHelix — CORS 友好、稳定在线多年。
 * 备选 Kevin MacLeod (incompetech) — CC BY 许可，需署名。
 */
const FREE_MUSIC_LIBRARY: Track[] = [
  // SoundHelix — 16+ 首在线，CORS 良好
  { id: 'sh-1',  name: 'Ambient Flow',       url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',  duration: 482, artist: 'SoundHelix' },
  { id: 'sh-2',  name: 'Electronic Dreams',  url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',  duration: 449, artist: 'SoundHelix' },
  { id: 'sh-3',  name: 'Chill Vibes',        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',  duration: 462, artist: 'SoundHelix' },
  { id: 'sh-4',  name: 'Piano Meditation',   url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',  duration: 428, artist: 'SoundHelix' },
  { id: 'sh-5',  name: 'Jazz Relaxation',    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',  duration: 473, artist: 'SoundHelix' },
  { id: 'sh-6',  name: 'Nature Sounds',      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',  duration: 491, artist: 'SoundHelix' },
  { id: 'sh-7',  name: 'Focus Flow',         url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',  duration: 437, artist: 'SoundHelix' },
  { id: 'sh-8',  name: 'Creative Spark',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',  duration: 454, artist: 'SoundHelix' },
  { id: 'sh-9',  name: 'Deep Concentration', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',  duration: 466, artist: 'SoundHelix' },
  { id: 'sh-10', name: 'Coding Rhythm',      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3', duration: 443, artist: 'SoundHelix' },
  { id: 'sh-11', name: 'Sunset Horizon',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3', duration: 478, artist: 'SoundHelix' },
  { id: 'sh-12', name: 'Midnight Calm',      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3', duration: 461, artist: 'SoundHelix' },
  { id: 'sh-13', name: 'Morning Light',      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3', duration: 445, artist: 'SoundHelix' },
  { id: 'sh-14', name: 'Ocean Breeze',       url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3', duration: 472, artist: 'SoundHelix' },
  { id: 'sh-15', name: 'Starry Night',       url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3', duration: 486, artist: 'SoundHelix' },
  { id: 'sh-16', name: 'Gentle Rain',        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3', duration: 459, artist: 'SoundHelix' },
  // Kevin MacLeod (CC BY 3.0) — 经典曲目
  { id: 'km-1', name: 'Merry Go',            url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Merry%20Go.mp3', duration: 180, artist: 'Kevin MacLeod' },
  { id: 'km-2', name: 'Brandenburg Concerto',url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bach%20Brandenburg%20Concerto%203.mp3', duration: 240, artist: 'Kevin MacLeod' },
];

/* ===== 格式化时间 ===== */
const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/* ===== 组件 ===== */
export const MusicPlayer: React.FC<{
  visible: boolean;
  onClose: () => void;
}> = ({ visible, onClose }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showList, setShowList] = useState(false);
  const [loopMode, setLoopMode] = useState<'none' | 'single' | 'list'>('list'); // 循环模式
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loopModeRef = useRef(loopMode);

  const currentTrack = currentIdx >= 0 && currentIdx < playlist.length ? playlist[currentIdx] : null;

  /* ---- Refs for async event handlers (avoid stale closure) ---- */
  const playlistRef = useRef(playlist);
  const currentIdxRef = useRef(currentIdx);
  const loadTrackRef = useRef<(idx: number) => void>(() => {});
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { loopModeRef.current = loopMode; }, [loopMode]);

  /* ---- 播放状态同步到状态栏 ♪ 动画 ---- */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('agentai:music-state', {
      detail: { playing },
    }));
  }, [playing]);

  /* ---- Audio element ---- */
  useEffect(() => {
    const audio = new Audio();
    audio.volume = volume;
    audioRef.current = audio;

    const onEnded = () => {
      if (playlistRef.current.length === 0) return;
      // 根据循环模式决定播放下一首还是重新播放当前曲目
      if (loopModeRef.current === 'single') {
        // 单曲循环：重新播放当前曲目
        loadTrackRef.current(currentIdxRef.current);
      } else if (loopModeRef.current === 'list') {
        // 列表循环：播放下一首
        const idx = (currentIdxRef.current + 1) % playlistRef.current.length;
        loadTrackRef.current(idx);
      } else {
        // 不循环：播放下一首，如果到最后一首则停止
        if (currentIdxRef.current < playlistRef.current.length - 1) {
          loadTrackRef.current(currentIdxRef.current + 1);
        } else {
          setPlaying(false);
        }
      }
    };

    const onError = () => {
      console.warn('MusicPlayer: track failed to load, skipping to next');
      onEnded();
    };

    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  /* ---- 播放控制 ---- */
  const loadTrack = useCallback((idx: number) => {
    const track = playlist[idx];
    if (!track || !audioRef.current) return;
    audioRef.current.src = proxyMusicUrl(track.url);
    audioRef.current.load();
    audioRef.current.play().catch(() => setPlaying(false));
    setCurrentIdx(idx);
    setCurrentTime(0);
  }, [playlist]);

  /* ---- 同步 ref 给事件处理器 ---- */
  useEffect(() => { loadTrackRef.current = loadTrack; }, [loadTrack]);

  /* ---- 加载预设免费音乐库 ---- */
  const loadFreeMusic = useCallback(() => {
    // 随机选取 5 首加入播放列表
    const shuffled = [...FREE_MUSIC_LIBRARY].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 5);
    setPlaylist(prev => [...prev, ...selected]);
    // 如果没有正在播放，自动播放第一首
    if (currentIdx < 0 && selected.length > 0) {
      setTimeout(() => loadTrack(playlist.length), 100);
    }
  }, [currentIdx, playlist.length, loadTrack]);

  /* ---- AI 音乐控制监听 ---- */
  useEffect(() => {
    const handleMusicAction = (e: CustomEvent) => {
      const { action, volume: newVol, trackIndex } = e.detail || {};
      switch (action) {
        case 'play':
          if (currentIdx >= 0 && audioRef.current) {
            audioRef.current.play().catch(() => setPlaying(false));
          } else if (playlist.length > 0) {
            loadTrack(0);
          } else {
            loadFreeMusic();
          }
          break;
        case 'pause':
          if (audioRef.current) audioRef.current.pause();
          break;
        case 'next':
          if (playlist.length > 0) {
            const idx = (currentIdx + 1) % playlist.length;
            loadTrack(idx);
          }
          break;
        case 'prev':
          if (playlist.length > 0) {
            const idx = currentIdx <= 0 ? playlist.length - 1 : currentIdx - 1;
            loadTrack(idx);
          }
          break;
        case 'volume':
          if (newVol !== undefined && audioRef.current) {
            audioRef.current.volume = newVol;
            setVolume(newVol);
          }
          break;
        case 'load_free':
          loadFreeMusic();
          break;
        case 'show':
          // 显示播放器面板由父组件控制，这里只展开播放列表
          setShowList(true);
          break;
      }
    };
    window.addEventListener('agentai:music-action', handleMusicAction as EventListener);
    return () => window.removeEventListener('agentai:music-action', handleMusicAction as EventListener);
  }, [currentIdx, playlist, loadTrack, loadFreeMusic]);

  /* ---- 音量同步 ---- */
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const handlePlayPause = () => {
    if (!audioRef.current || !currentTrack) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => setPlaying(false));
    }
  };

  const handlePrev = () => {
    if (playlist.length === 0) return;
    const idx = currentIdx <= 0 ? playlist.length - 1 : currentIdx - 1;
    loadTrack(idx);
  };

  const handleNext = () => {
    if (playlist.length === 0) return;
    const idx = (currentIdx + 1) % playlist.length;
    loadTrack(idx);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  /* ---- 文件导入 ---- */
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newTracks: Track[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('audio/')) {
        newTracks.push({
          id: `track-${Date.now()}-${i}`,
          name: file.name.replace(/\.[^/.]+$/, ''),
          url: URL.createObjectURL(file),
          duration: 0,
        });
      }
    }

    setPlaylist(prev => [...prev, ...newTracks]);
    // 如果没有正在播放，自动播放第一个
    if (currentIdx < 0 && newTracks.length > 0) {
      setTimeout(() => loadTrack(playlist.length), 100);
    }
    // 重置 input
    e.target.value = '';
  };

  const handleRemoveTrack = (idx: number) => {
    const track = playlist[idx];
    if (track?.url.startsWith('blob:')) URL.revokeObjectURL(track.url);
    setPlaylist(prev => prev.filter((_, i) => i !== idx));
    if (idx === currentIdx) {
      audioRef.current?.pause();
      setCurrentIdx(-1);
      setPlaying(false);
    } else if (idx < currentIdx) {
      setCurrentIdx(prev => prev - 1);
    }
  };

  /* ---- 加载默认演示曲目 ---- */
  const loadDemoTrack = () => {
    // 使用 Web Audio API 生成简单的测试音调
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const sampleRate = audioCtx.sampleRate;
    const durationSec = 8;
    const length = sampleRate * durationSec;
    const buffer = audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // 生成简单的旋律
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const freq = 440 + Math.sin(t * 2) * 220;
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.3 * Math.max(0, 1 - t / durationSec);
    }

    // 转 WAV Blob
    const wav = bufferToWav(buffer);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    const demo: Track = {
      id: 'demo',
      name: '演示旋律 (Demo)',
      url,
      duration: durationSec,
      artist: 'PulseFlow',
    };
    setPlaylist(prev => [demo, ...prev]);
    setTimeout(() => loadTrack(0), 100);
    audioCtx.close();
  };

  return (
    <div style={{
      display: visible ? 'block' : 'none',
      position: 'fixed', bottom: 44, right: 16,
      width: 320,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      zIndex: 1000,
      overflow: 'hidden',
      animation: 'msgSlideIn 0.25s cubic-bezier(0.16,1,0.3,1) forwards',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px', borderBottom: '1px solid var(--border)',
      }}>
        <SoundOutlined style={{ color: 'var(--accent)', fontSize: 14 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', flex: 1 }}>
          音乐播放器
        </span>
        <button
          onClick={() => setShowList(v => !v)}
          style={{
            width: 22, height: 22, borderRadius: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', background: showList ? 'var(--panel)' : 'transparent',
            cursor: 'pointer', color: 'var(--muted-2)',
          }}
        >
          <MenuOutlined style={{ fontSize: 11 }} />
        </button>
        <button
          onClick={onClose}
          style={{
            width: 22, height: 22, borderRadius: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--muted-2)',
          }}
        >
          <CloseOutlined style={{ fontSize: 11 }} />
        </button>
      </div>

      {/* Now playing info */}
      <div style={{ padding: '8px 12px', textAlign: 'center' }}>
        {/* 播放动画 */}
        {playing && currentTrack && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 3, marginBottom: 6,
          }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div
                key={i}
                style={{
                  width: 3, height: 12 + Math.random() * 8,
                  background: 'var(--accent)',
                  borderRadius: 2,
                  animation: `musicBar${i % 3} 0.8s ease-in-out infinite`,
                }}
              />
            ))}
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
          {currentTrack?.name || '未选择曲目'}
        </div>
        {currentTrack?.artist && (
          <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 2 }}>
            {currentTrack.artist}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {currentTrack && (
        <div style={{ padding: '0 12px' }}>
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            style={{ width: '100%', height: 3 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted-2)' }}>
            <span>{fmtTime(currentTime)}</span>
            <span>{fmtTime(duration)}</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 12, padding: '6px 12px',
      }}>
        <button onClick={handlePrev} style={ctrlBtnStyle} disabled={playlist.length === 0}>
          <StepBackwardOutlined style={{ fontSize: 14 }} />
        </button>
        <button
          onClick={handlePlayPause}
          style={{
            ...ctrlBtnStyle, width: 32, height: 32, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff',
          }}
          disabled={!currentTrack}
        >
          {playing ? <PauseCircleOutlined style={{ fontSize: 16 }} /> : <PlayCircleOutlined style={{ fontSize: 16 }} />}
        </button>
        <button onClick={handleNext} style={ctrlBtnStyle} disabled={playlist.length === 0}>
          <StepForwardOutlined style={{ fontSize: 14 }} />
        </button>
        {/* 循环模式按钮 */}
        <button
          onClick={() => setLoopMode(v => v === 'none' ? 'single' : v === 'single' ? 'list' : 'none')}
          style={{
            ...ctrlBtnStyle,
            background: loopMode !== 'none' ? 'var(--accent)' : 'transparent',
            color: loopMode !== 'none' ? '#fff' : 'var(--muted-2)',
          }}
          title={loopMode === 'none' ? '不循环' : loopMode === 'single' ? '单曲循环' : '列表循环'}
        >
          {loopMode === 'single' ? '🔂' : '🔁'}
        </button>
      </div>

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 8px' }}>
        <SoundOutlined style={{ fontSize: 10, color: 'var(--muted-2)' }} />
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={e => setVolume(parseFloat(e.target.value))}
          style={{ flex: 1, height: 3 }}
        />
      </div>

      {/* Playlist */}
      {showList && (
        <div style={{
          borderTop: '1px solid var(--border)',
          maxHeight: 160, overflowY: 'auto',
          background: 'var(--bg-2)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderBottom: '1px solid var(--border)',
          }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 4, fontSize: 10,
                background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              <UploadOutlined style={{ fontSize: 10 }} /> 导入音乐
            </button>
            {playlist.length === 0 && (
              <button
                onClick={loadDemoTrack}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 4, fontSize: 10,
                  background: 'var(--panel)', border: '1px solid var(--border)',
                  color: 'var(--muted)', cursor: 'pointer',
                }}
              >
                加载演示曲目
              </button>
            )}
            <button
              onClick={loadFreeMusic}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 4, fontSize: 10,
                background: 'var(--accent-soft)', border: '1px solid var(--accent)',
                color: 'var(--accent)', cursor: 'pointer',
              }}
            >
              加载免费音乐
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              onChange={handleFileImport}
              style={{ display: 'none' }}
            />
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: 'var(--muted-2)' }}>{playlist.length} 首</span>
          </div>
          {playlist.map((track, i) => (
            <div
              key={track.id}
              onClick={() => loadTrack(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', cursor: 'pointer',
                fontSize: 11, color: 'var(--fg-2)',
                background: i === currentIdx ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <span style={{
                width: 3, height: 3, borderRadius: '50%',
                background: i === currentIdx && playing ? 'var(--accent)' : 'var(--muted-2)',
                animation: i === currentIdx && playing ? 'pulse 1.2s ease-out infinite' : undefined,
                flexShrink: 0,
              }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {track.name}
              </span>
              <button
                onClick={e => { e.stopPropagation(); handleRemoveTrack(i); }}
                style={{
                  width: 16, height: 16, borderRadius: 3,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  color: 'var(--muted-2)', opacity: 0.5,
                }}
              >
                <DeleteOutlined style={{ fontSize: 9 }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ctrlBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', background: 'transparent', cursor: 'pointer',
  color: 'var(--muted)', transition: 'all 0.1s',
};

/* ===== WAV 转换工具 ===== */
function bufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;
  const data = audioBuffer.getChannelData(0);

  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = data.length * numChannels * bitsPerSample / 8;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write samples
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * 通过 Gateway 代理播放远程音乐，避免浏览器 CORS 限制
 */
function proxyMusicUrl(url: string): string {
  // blob/data URL 不走代理
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  // 已经是本地代理的 URL 不再重复代理
  if (url.includes('/v1/music/proxy?')) return url;
  // 通过 Gateway 代理
  const base = window.location.origin;
  return `${base}/v1/music/proxy?url=${encodeURIComponent(url)}`;
}
