import { useState, useRef, useEffect } from 'react'
import { Button, Space, Slider, Typography, Tooltip, message } from 'antd'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  SoundOutlined,
  ReloadOutlined,
  CloseOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'

const { Text } = Typography

interface Track {
  id: string
  name: string
  artist?: string
  url: string
  duration?: number
}

interface MusicPlayerProps {
  playlist?: Track[]
  onClose?: () => void
}

const defaultPlaylist: Track[] = [
  { id: '1', name: '轻音乐 - 放松时刻', url: '' },
  { id: '2', name: '钢琴曲 - 静心思考', url: '' },
  { id: '3', name: '自然音 - 森林鸟鸣', url: '' },
]

const MusicPlayer: React.FC<MusicPlayerProps> = ({ playlist = defaultPlaylist, onClose }) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration] = useState(180)
  const [volume, setVolume] = useState(80)
  const [minimized, setMinimized] = useState(false)
  
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentTrack = playlist[currentTrackIndex]

  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= duration) {
            handleNext()
            return 0
          }
          return prev + 1
        })
      }, 1000)
    } else {
      if (progressInterval.current) {
        clearInterval(progressInterval.current)
      }
    }

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current)
      }
    }
  }, [isPlaying, duration])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying)
    if (!isPlaying) {
      message.info(`正在播放: ${currentTrack.name}`)
    }
  }

  const handlePrev = () => {
    setCurrentTrackIndex(prev => (prev - 1 + playlist.length) % playlist.length)
    setCurrentTime(0)
  }

  const handleNext = () => {
    setCurrentTrackIndex(prev => (prev + 1) % playlist.length)
    setCurrentTime(0)
  }

  const handleProgressChange = (value: number) => {
    setCurrentTime(value)
  }

  const handleVolumeChange = (value: number) => {
    setVolume(value)
    if (audioRef.current) {
      audioRef.current.volume = value / 100
    }
  }

  if (minimized) {
    return (
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="fixed bottom-4 right-4 z-50"
      >
        <Tooltip title="音乐播放器">
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => setMinimized(false)}
            className="shadow-lg"
            style={{ width: 56, height: 56 }}
          />
        </Tooltip>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="bg-white rounded-xl shadow-lg overflow-hidden"
    >
      <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-4">
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <SoundOutlined className="text-xl" />
            <Text strong className="text-white">音乐播放器</Text>
          </div>
          <Space>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => {
                setCurrentTime(0)
                setIsPlaying(false)
              }}
              className="text-white hover:bg-white/20"
              size="small"
            />
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={onClose}
              className="text-white hover:bg-white/20"
              size="small"
            />
          </Space>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-3 mb-4">
          <motion.div
            animate={isPlaying ? { rotate: 360 } : {}}
            transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
            className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center"
          >
            <SoundOutlined className="text-white text-xl" />
          </motion.div>
          <div className="flex-1 min-w-0">
            <Text strong className="block truncate">{currentTrack.name}</Text>
            <Text type="secondary" className="text-sm">
              {currentTrack.artist || '智 Y.Ai 推荐'}
            </Text>
          </div>
        </div>

        <div className="mb-4">
          <Slider
            value={currentTime}
            max={duration}
            onChange={handleProgressChange}
            tooltip={{ formatter: (value) => formatTime(value || 0) }}
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mb-4">
          <Button
            type="text"
            icon={<StepBackwardOutlined className="text-xl" />}
            onClick={handlePrev}
          />
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={isPlaying ? <PauseCircleOutlined className="text-2xl" /> : <PlayCircleOutlined className="text-2xl" />}
            
            onClick={handlePlayPause}
            className="w-14 h-14"
          />
          <Button
            type="text"
            icon={<StepForwardOutlined className="text-xl" />}
            onClick={handleNext}
          />
        </div>

        <div className="flex items-center gap-2">
          <SoundOutlined className="text-gray-400" />
          <Slider
            value={volume}
            onChange={handleVolumeChange}
            style={{ width: 100 }}
            tooltip={{ formatter: (value) => `${value}%` }}
          />
        </div>

        <div className="mt-4 border-t pt-3">
          <Text type="secondary" className="text-xs mb-2 block">播放列表</Text>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {playlist.map((track, index) => (
              <div
                key={track.id}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-all ${
                  index === currentTrackIndex ? 'bg-purple-50 text-purple-600' : 'hover:bg-gray-50'
                }`}
                onClick={() => {
                  setCurrentTrackIndex(index)
                  setCurrentTime(0)
                  setIsPlaying(true)
                }}
              >
                <span className="text-xs w-4">{index + 1}</span>
                <Text className="flex-1 truncate text-sm">{track.name}</Text>
                {index === currentTrackIndex && isPlaying && (
                  <motion.div
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="flex gap-0.5"
                  >
                    <div className="w-0.5 h-3 bg-purple-500 rounded" />
                    <div className="w-0.5 h-3 bg-purple-500 rounded" style={{ animationDelay: '0.1s' }} />
                    <div className="w-0.5 h-3 bg-purple-500 rounded" style={{ animationDelay: '0.2s' }} />
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default MusicPlayer
