"""
音乐播放器服务
支持多源音乐获取、有效性检测和自动更新
"""

import asyncio
import aiohttp
import logging
import time
import random
import os
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class EmotionType(Enum):
    """情绪类型"""
    HAPPY = "happy"
    SAD = "sad"
    ANGRY = "angry"
    ANXIOUS = "anxious"
    RELAXED = "relaxed"
    EXCITED = "excited"
    CALM = "calm"
    NEUTRAL = "neutral"


@dataclass
class Track:
    """音乐曲目"""
    id: str
    title: str
    artist: str
    album: str
    duration: int
    url: str
    stream_url: str
    cover_image: Optional[str] = None
    genre: Optional[str] = None


@dataclass
class Playlist:
    """播放列表"""
    id: str
    name: str
    tracks: List[Track]
    emotion: Optional[EmotionType] = None






class MusicPlayerService:
    """音乐播放器服务"""
    
    def __init__(self):
        self.fma_api_key = "YOUR_FMA_API_KEY"
        self.fma_base_url = "https://freemusicarchive.org/api"
        self.current_playlist: Optional[Playlist] = None
        self.current_track_index: int = 0
        self.is_playing: bool = False
        self.volume: float = 0.7
        
        # 情绪到音乐风格的映射
        self.emotion_to_genre = {
            EmotionType.HAPPY: ["pop", "upbeat", "electronic", "dance", "funk", "hip-hop"],
            EmotionType.SAD: ["ambient", "classical", "piano", "instrumental", "blues", "soul"],
            EmotionType.ANGRY: ["rock", "metal", "punk", "alternative"],
            EmotionType.ANXIOUS: ["ambient", "classical", "meditation", "nature"],
            EmotionType.RELAXED: ["ambient", "chill", "lo-fi", "jazz", "reggae", "folk"],
            EmotionType.EXCITED: ["electronic", "dance", "pop", "upbeat", "rock", "hip-hop"],
            EmotionType.CALM: ["ambient", "classical", "piano", "instrumental", "folk"],
            EmotionType.NEUTRAL: ["pop", "rock", "jazz", "blues", "country", "soul"]
        }
        
        # 音乐源配置
        self.music_sources = {
            "soundhelix": {
                "name": "SoundHelix",
                "base_url": "https://www.soundhelix.com/examples/mp3",
                "format": "SoundHelix-Song-{}.mp3",
                "range": (1, 50),
                "genre": "various",
                "active": True
            },
            "freemusicarchive": {
                "name": "Free Music Archive",
                "base_url": "https://freemusicarchive.org/api",
                "api_key": self.fma_api_key,
                "active": True
            },
            "jamendo": {
                "name": "Jamendo",
                "base_url": "https://api.jamendo.com/v3.0",
                "api_key": "YOUR_JAMENDO_API_KEY",
                "active": False  # 需要API密钥
            },
            "ccmixter": {
                "name": "ccMixter",
                "base_url": "https://ccmixter.org/api/query",
                "active": True
            },
            "audionautix": {
                "name": "Audionautix",
                "base_url": "https://audionautix.com",
                "active": True
            }
        }
        
        # 本地音乐库
        self.local_music_library = self._init_local_library()
        
        # 音乐源状态和上次更新时间
        self.source_status = {}
        self.last_update_time = 0
        self.update_interval = 3600  # 1小时自动更新一次
        
        # 初始化时暂不启动自动更新任务，因为可能没有运行的事件循环
        # 自动更新将在应用启动后通过适当的事件循环启动
        self.auto_update_task = None
        self.validation_task = None
    
    def _init_local_library(self) -> List[Dict[str, Any]]:
        """初始化本地音乐库（免费音乐）"""
        library = []
        
        # 添加SoundHelix音乐
        for i in range(1, 21):
            library.append({
                "id": f"soundhelix_{i}",
                "title": f"SoundHelix Song {i}",
                "artist": "SoundHelix",
                "album": "Generated Music",
                "duration": 180,
                "url": "",
                "stream_url": f"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-{i}.mp3",
                "genre": "various",
                "emotion": EmotionType.NEUTRAL
            })
        
        # 添加其他免费音乐源
        library.extend([
            {
                "id": "incompetech_001",
                "title": "Merry Go",
                "artist": "Kevin MacLeod",
                "album": "Incompetech",
                "duration": 180,
                "url": "https://incompetech.com",
                "stream_url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Merry%20Go.mp3",
                "genre": "happy",
                "emotion": EmotionType.HAPPY
            },
            {
                "id": "incompetech_002",
                "title": "Bach Brandenburg Concerto 3",
                "artist": "Kevin MacLeod",
                "album": "Incompetech",
                "duration": 240,
                "url": "https://incompetech.com",
                "stream_url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bach%20Brandenburg%20Concerto%203.mp3",
                "genre": "classical",
                "emotion": EmotionType.CALM
            },
            {
                "id": "bensound_001",
                "title": "Acoustic Breeze",
                "artist": "BenSound",
                "album": "Bensound",
                "duration": 210,
                "url": "https://www.bensound.com",
                "stream_url": "https://www.bensound.com/bensound-music/bensound-acousticbreeze.mp3",
                "genre": "acoustic",
                "emotion": EmotionType.RELAXED
            },
            {
                "id": "musopen_001",
                "title": "Beethoven Symphony No. 5",
                "artist": "Musopen",
                "album": "Musopen",
                "duration": 300,
                "url": "https://musopen.org",
                "stream_url": "https://musopen.org/music/1769-ludwig-van-beethoven/symphony-no-5-in-c-minor-op-67/",
                "genre": "classical",
                "emotion": EmotionType.EXCITED
            }
        ])
        
        logger.info(f"本地音乐库初始化完成，共 {len(library)} 首音乐")
        return library


    async def search_music(self, query: str, limit: int = 10) -> List[Track]:
        """搜索音乐"""
        try:
            # 使用多源搜索
            results = await self._search_multiple_sources(query, limit)
            
            if not results:
                # 如果没有结果，返回一些默认音乐
                logger.info(f"搜索 '{query}' 无结果，返回默认音乐")
                return self.get_all_tracks(limit)
            
            return results
            
        except Exception as e:
            logger.error(f"搜索音乐失败: {str(e)}")
            return self.get_all_tracks(limit)
    
    def _search_local_library(self, query: str, limit: int) -> List[Track]:
        """在本地库中搜索音乐"""
        query_lower = query.lower()
        results = []
        
        for music in self.local_music_library:
            if (query_lower in music["title"].lower() or
                query_lower in music["artist"].lower() or
                query_lower in music["genre"].lower()):
                results.append(Track(
                    id=music["id"],
                    title=music["title"],
                    artist=music["artist"],
                    album=music["album"],
                    duration=music["duration"],
                    url=music["url"],
                    stream_url=music["stream_url"],
                    genre=music["genre"]
                ))
                
                if len(results) >= limit:
                    break
        
        return results
    
    async def _search_fma_api(self, query: str, limit: int) -> List[Track]:
        """使用FMA API搜索音乐"""
        try:
            async with aiohttp.ClientSession() as session:
                params = {
                    "api_key": self.fma_api_key,
                    "q": query,
                    "limit": limit
                }
                
                async with session.get(
                    f"{self.fma_base_url}/get/track",
                    params=params
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        tracks = []
                        
                        for track_data in data.get("tracks", []):
                            tracks.append(Track(
                                id=str(track_data.get("track_id", "")),
                                title=track_data.get("track_title", ""),
                                artist=track_data.get("artist_name", ""),
                                album=track_data.get("album_title", ""),
                                duration=track_data.get("track_duration", 0),
                                url=track_data.get("track_url", ""),
                                stream_url=track_data.get("track_stream_url", ""),
                                cover_image=track_data.get("track_image_file", ""),
                                genre=track_data.get("track_genres", "")
                            ))
                        
                        return tracks
            
            return []
            
        except Exception as e:
            logger.error(f"FMA API搜索失败: {str(e)}")
            return []
    
    def get_music_by_emotion(self, emotion: str, limit: int = 10) -> List[Track]:
        """根据情绪获取音乐"""
        try:
            emotion_type = EmotionType(emotion.lower())
            genres = self.emotion_to_genre.get(emotion_type, ["pop"])
            
            results = []
            for music in self.local_music_library:
                if music["genre"] in genres or music.get("emotion") == emotion_type:
                    results.append(Track(
                        id=music["id"],
                        title=music["title"],
                        artist=music["artist"],
                        album=music["album"],
                        duration=music["duration"],
                        url=music["url"],
                        stream_url=music["stream_url"],
                        genre=music["genre"]
                    ))
                    
                    if len(results) >= limit:
                        break
            
            return results
            
        except ValueError:
            logger.warning(f"无效的情绪类型: {emotion}")
            return self.get_all_tracks(limit)
    
    def get_all_tracks(self, limit: int = 100) -> List[Track]:
        """获取所有音乐"""
        results = []
        valid_music_count = 0
        
        # 优先返回本地音乐库中的音乐
        for music in self.local_music_library:
            if valid_music_count >= limit:
                break
            
            # 直接添加本地音乐，不做URL验证（避免网络请求）
            results.append(Track(
                id=music["id"],
                title=music["title"],
                artist=music["artist"],
                album=music["album"],
                duration=music["duration"],
                url=music["url"],
                stream_url=music["stream_url"],
                genre=music["genre"]
            ))
            valid_music_count += 1
        
        # 如果本地音乐不足，添加SoundHelix的音乐
        if valid_music_count < limit and self.music_sources.get("soundhelix", {}).get("active"):
            soundhelix_config = self.music_sources["soundhelix"]
            needed_count = limit - valid_music_count
            
            for i in range(1, min(needed_count + 1, soundhelix_config["range"][1] + 1)):
                track_id = f"soundhelix_extra_{i}"
                # 检查是否已存在
                if not any(t.id == track_id for t in results):
                    track = Track(
                        id=track_id,
                        title=f"SoundHelix Song {i}",
                        artist="SoundHelix",
                        album="Generated Music",
                        duration=180,
                        url="",
                        stream_url=f"{soundhelix_config['base_url']}/{soundhelix_config['format'].format(i)}",
                        genre="various",
                        cover_image=None
                    )
                    results.append(track)
        
        # 如果仍然不足，添加其他免费音乐源
        if valid_music_count < limit:
            # 添加Incompetech音乐
            incompetech_tracks = [
                {
                    "id": "incompetech_001",
                    "title": "Merry Go",
                    "artist": "Kevin MacLeod",
                    "album": "Incompetech",
                    "duration": 180,
                    "url": "https://incompetech.com",
                    "stream_url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Merry%20Go.mp3",
                    "genre": "happy"
                },
                {
                    "id": "incompetech_002",
                    "title": "Bach Brandenburg Concerto 3",
                    "artist": "Kevin MacLeod",
                    "album": "Incompetech",
                    "duration": 240,
                    "url": "https://incompetech.com",
                    "stream_url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bach%20Brandenburg%20Concerto%203.mp3",
                    "genre": "classical"
                },
                {
                    "id": "incompetech_003",
                    "title": "Scheming Weasel",
                    "artist": "Kevin MacLeod",
                    "album": "Incompetech",
                    "duration": 120,
                    "url": "https://incompetech.com",
                    "stream_url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Scheming%20Weasel.mp3",
                    "genre": "comedy"
                }
            ]
            
            for track in incompetech_tracks:
                if valid_music_count >= limit:
                    break
                # 检查是否已存在相同ID的音乐
                if not any(t.id == track["id"] for t in results):
                    results.append(Track(
                        id=track["id"],
                        title=track["title"],
                        artist=track["artist"],
                        album=track["album"],
                        duration=track["duration"],
                        url=track["url"],
                        stream_url=track["stream_url"],
                        genre=track["genre"]
                    ))
                    valid_music_count += 1
            
            # 添加中文流行音乐
            chinese_tracks = [
                # 网易云音乐流行歌曲
                {
                    "id": "chinese_001",
                    "title": "周杰伦 - 晴天",
                    "artist": "周杰伦",
                    "album": "叶惠美",
                    "duration": 263,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=186016.mp3",
                    "genre": "pop"
                },
                {
                    "id": "chinese_002",
                    "title": "陈奕迅 - 浮夸",
                    "artist": "陈奕迅",
                    "album": "U87",
                    "duration": 346,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=276898.mp3",
                    "genre": "pop"
                },
                {
                    "id": "chinese_004",
                    "title": "邓紫棋 - 光年之外",
                    "artist": "邓紫棋",
                    "album": "光年之外",
                    "duration": 325,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=5230834.mp3",
                    "genre": "pop"
                },
                {
                    "id": "chinese_005",
                    "title": "林俊杰 - 江南",
                    "artist": "林俊杰",
                    "album": "第二天堂",
                    "duration": 345,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=324600.mp3",
                    "genre": "pop"
                },
                {
                    "id": "chinese_006",
                    "title": "周杰伦 - 七里香",
                    "artist": "周杰伦",
                    "album": "七里香",
                    "duration": 343,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=186088.mp3",
                    "genre": "pop"
                },
                {
                    "id": "chinese_007",
                    "title": "陈奕迅 - 富士山下",
                    "artist": "陈奕迅",
                    "album": "What's Going On...?",
                    "duration": 394,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=277814.mp3",
                    "genre": "pop"
                },
                {
                    "id": "chinese_008",
                    "title": "林俊杰 - 可惜没如果",
                    "artist": "林俊杰",
                    "album": "新地球",
                    "duration": 380,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=30832862.mp3",
                    "genre": "pop"
                },
                {
                    "id": "chinese_009",
                    "title": "邓紫棋 - 泡沫",
                    "artist": "邓紫棋",
                    "album": "Xposed",
                    "duration": 278,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=27569590.mp3",
                    "genre": "pop"
                },
                {
                    "id": "chinese_010",
                    "title": "周杰伦 - 青花瓷",
                    "artist": "周杰伦",
                    "album": "我很忙",
                    "duration": 293,
                    "url": "",
                    "stream_url": "https://music.163.com/song/media/outer/url?id=364256.mp3",
                    "genre": "pop"
                },
                # QQ音乐流行歌曲
                {
                    "id": "chinese_011",
                    "title": "李荣浩 - 模特",
                    "artist": "李荣浩",
                    "album": "模特",
                    "duration": 275,
                    "url": "",
                    "stream_url": "https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV",
                    "genre": "pop"
                },
                {
                    "id": "chinese_012",
                    "title": "薛之谦 - 演员",
                    "artist": "薛之谦",
                    "album": "绅士",
                    "duration": 381,
                    "url": "",
                    "stream_url": "https://y.qq.com/n/ryqq/songDetail/003w49Se3BdZcD",
                    "genre": "pop"
                },
                {
                    "id": "chinese_013",
                    "title": "毛不易 - 消愁",
                    "artist": "毛不易",
                    "album": "平凡的一天",
                    "duration": 343,
                    "url": "",
                    "stream_url": "https://y.qq.com/n/ryqq/songDetail/001bdm1025Dy8r",
                    "genre": "pop"
                },
                {
                    "id": "chinese_014",
                    "title": "TFBOYS - 青春修炼手册",
                    "artist": "TFBOYS",
                    "album": "青春修炼手册",
                    "duration": 255,
                    "url": "",
                    "stream_url": "https://y.qq.com/n/ryqq/songDetail/000eXnUv1m7lHq",
                    "genre": "pop"
                },
                {
                    "id": "chinese_015",
                    "title": "张艺兴 - 梦不落雨林",
                    "artist": "张艺兴",
                    "album": "梦不落雨林/NAMANANA",
                    "duration": 307,
                    "url": "",
                    "stream_url": "https://y.qq.com/n/ryqq/songDetail/002C3HfM1hIesr",
                    "genre": "pop"
                }
            ]
            
            for track in chinese_tracks:
                if valid_music_count >= limit:
                    break
                # 检查是否已存在相同ID的音乐
                if not any(t.id == track["id"] for t in results):
                    results.append(Track(
                        id=track["id"],
                        title=track["title"],
                        artist=track["artist"],
                        album=track["album"],
                        duration=track["duration"],
                        url=track["url"],
                        stream_url=track["stream_url"],
                        genre=track["genre"]
                    ))
                    valid_music_count += 1
        
        logger.info(f"返回音乐列表，共 {len(results)} 首音乐")
        return results
    
    def create_playlist(self, name: str, tracks: List[Track], emotion: Optional[str] = None) -> Playlist:
        """创建播放列表"""
        playlist_id = f"playlist_{len(name)}_{asyncio.get_event_loop().time()}"
        
        emotion_type = None
        if emotion:
            try:
                emotion_type = EmotionType(emotion.lower())
            except ValueError:
                pass
        
        playlist = Playlist(
            id=playlist_id,
            name=name,
            tracks=tracks,
            emotion=emotion_type
        )
        
        return playlist
    
    def set_playlist(self, playlist: Playlist) -> None:
        """设置当前播放列表"""
        self.current_playlist = playlist
        self.current_track_index = 0
        self.is_playing = False
    
    def play_track(self, track_index: int = None) -> Optional[Track]:
        """播放指定曲目"""
        if not self.current_playlist:
            return None
        
        if track_index is not None:
            self.current_track_index = track_index
        
        self.is_playing = True
        return self.get_current_track()
    
    def pause_track(self) -> None:
        """暂停播放"""
        self.is_playing = False
    
    def next_track(self) -> Optional[Track]:
        """下一首"""
        if not self.current_playlist:
            return None
        
        self.current_track_index = (self.current_track_index + 1) % len(self.current_playlist.tracks)
        return self.get_current_track()
    
    def previous_track(self) -> Optional[Track]:
        """上一首"""
        if not self.current_playlist:
            return None
        
        self.current_track_index = (self.current_track_index - 1) % len(self.current_playlist.tracks)
        return self.get_current_track()
    
    def get_current_track(self) -> Optional[Track]:
        """获取当前曲目"""
        if not self.current_playlist:
            return None
        
        if 0 <= self.current_track_index < len(self.current_playlist.tracks):
            return self.current_playlist.tracks[self.current_track_index]
        
        return None
    
    def set_volume(self, volume: float) -> None:
        """设置音量"""
        self.volume = max(0.0, min(1.0, volume))
    
    def get_volume(self) -> float:
        """获取当前音量"""
        return self.volume

    def is_track_playing(self) -> bool:
        """检查是否正在播放"""
        return self.is_playing

    async def _validate_music_source(self, source_name: str, url: str) -> bool:
        """验证音乐源有效性"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.head(url, timeout=10) as response:
                    return response.status == 200
        except Exception as e:
            logger.warning(f"验证音乐源 {source_name} 失败: {str(e)}")
            return False

    async def _validate_all_music_sources(self):
        """验证所有音乐源有效性"""
        logger.info("开始验证音乐源有效性")
        
        for source_name, source_config in self.music_sources.items():
            if source_config.get("active"):
                try:
                    # 对于不同的源，使用不同的验证方法
                    if source_name == "soundhelix":
                        test_url = f"{source_config['base_url']}/{source_config['format'].format(1)}"
                        is_valid = await self._validate_music_source(source_name, test_url)
                    elif source_name == "freemusicarchive":
                        # FMA API验证
                        test_url = f"{source_config['base_url']}/get/artists?api_key={source_config['api_key']}&limit=1"
                        is_valid = await self._validate_music_source(source_name, test_url)
                    else:
                        # 其他源的验证
                        is_valid = True
                        
                    self.source_status[source_name] = {
                        "valid": is_valid,
                        "last_checked": time.time()
                    }
                    
                    logger.info(f"音乐源 {source_name} 验证结果: {'有效' if is_valid else '无效'}")
                except Exception as e:
                    logger.error(f"验证音乐源 {source_name} 时出错: {str(e)}")
                    self.source_status[source_name] = {
                        "valid": False,
                        "last_checked": time.time()
                    }

    async def _auto_update_music_sources(self):
        """自动更新音乐源"""
        while True:
            try:
                current_time = time.time()
                if current_time - self.last_update_time >= self.update_interval:
                    logger.info("开始自动更新音乐源")
                    
                    # 验证音乐源有效性
                    await self._validate_all_music_sources()
                    
                    # 更新本地音乐库
                    self._refresh_local_library()
                    
                    self.last_update_time = current_time
                    logger.info("音乐源更新完成")
                
                await asyncio.sleep(600)  # 每10分钟检查一次
            except Exception as e:
                logger.error(f"自动更新音乐源时出错: {str(e)}")
                await asyncio.sleep(600)

    def _refresh_local_library(self):
        """刷新本地音乐库"""
        # 移除无效的音乐条目
        valid_music = []
        for music in self.local_music_library:
            # 验证stream_url是否有效
            if self._is_valid_url(music.get("stream_url", "")):
                valid_music.append(music)
            else:
                logger.warning(f"移除无效音乐: {music.get('title', 'Unknown')}")
        
        # 添加新的音乐条目
        new_music_count = 0
        if self.source_status.get("soundhelix", {}).get("valid", False):
            # 从SoundHelix添加更多音乐
            soundhelix_config = self.music_sources["soundhelix"]
            for i in range(21, 51):  # 添加更多音乐
                music_id = f"soundhelix_{i}"
                # 检查是否已存在
                if not any(m.get("id") == music_id for m in valid_music):
                    new_music = {
                        "id": music_id,
                        "title": f"SoundHelix Song {i}",
                        "artist": "SoundHelix",
                        "album": "Generated Music",
                        "duration": 180,
                        "url": "",
                        "stream_url": f"{soundhelix_config['base_url']}/{soundhelix_config['format'].format(i)}",
                        "genre": "electronic",
                        "emotion": random.choice(list(EmotionType))
                    }
                    valid_music.append(new_music)
                    new_music_count += 1
        
        self.local_music_library = valid_music
        logger.info(f"本地音乐库刷新完成，添加了 {new_music_count} 首新音乐")

    def _is_valid_url(self, url: str) -> bool:
        """检查URL是否有效"""
        if not url:
            return False
        
        # 简单的URL格式检查
        import re
        url_pattern = re.compile(r'^https?://.+')
        return bool(url_pattern.match(url))

    async def upload_local_music(self, title: str, artist: str, file_content: bytes, file_extension: str) -> Track:
        """上传本地音乐"""
        try:
            # 生成唯一ID
            track_id = f"local_upload_{int(time.time())}_{random.randint(1000, 9999)}"
            
            # 保存文件到临时位置
            import tempfile
            import os
            
            with tempfile.NamedTemporaryFile(suffix=f".{file_extension}", delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file_path = temp_file.name
            
            # 创建Track对象
            track = Track(
                id=track_id,
                title=title,
                artist=artist,
                album="本地音乐",
                duration=0,  # 暂时设为0
                url=temp_file_path,
                stream_url=temp_file_path,
                genre="local",
                cover_image=None
            )
            
            # 添加到本地音乐库
            self.local_music_library.append({
                "id": track_id,
                "title": title,
                "artist": artist,
                "album": "本地音乐",
                "duration": 0,
                "url": temp_file_path,
                "stream_url": temp_file_path,
                "genre": "local",
                "emotion": EmotionType.NEUTRAL
            })
            
            logger.info(f"本地音乐上传成功: {title} - {artist}")
            return track
        except Exception as e:
            logger.error(f"上传本地音乐失败: {str(e)}")
            raise
    
    def get_playlist_info(self) -> Optional[Dict[str, Any]]:
        """获取播放列表信息"""
        if not self.current_playlist:
            return None
        
        return {
            "id": self.current_playlist.id,
            "name": self.current_playlist.name,
            "emotion": self.current_playlist.emotion.value if self.current_playlist.emotion else None,
            "total_tracks": len(self.current_playlist.tracks),
            "current_track_index": self.current_track_index,
            "is_playing": self.is_playing,
            "volume": self.volume
        }

    async def _search_multiple_sources(self, query: str, limit: int = 10) -> List[Track]:
        """从多个源搜索音乐"""
        results = []
        
        # 1. 首先从本地库搜索
        local_results = self._search_local_library(query, limit)
        results.extend(local_results)
        
        if len(results) >= limit:
            return results[:limit]
        
        # 2. 从其他源搜索
        remaining_limit = limit - len(results)
        
        # 搜索FMA API
        if self.music_sources.get("freemusicarchive", {}).get("active"):
            fma_results = await self._search_fma_api(query, remaining_limit)
            results.extend(fma_results)
        
        if len(results) >= limit:
            return results[:limit]
        
        # 3. 从SoundHelix搜索（基于关键词匹配）
        remaining_limit = limit - len(results)
        if self.music_sources.get("soundhelix", {}).get("active"):
            soundhelix_results = self._search_soundhelix(query, remaining_limit)
            results.extend(soundhelix_results)
        
        return results[:limit]

    def _search_soundhelix(self, query: str, limit: int) -> List[Track]:
        """从SoundHelix搜索音乐"""
        results = []
        query_lower = query.lower()
        
        # SoundHelix的音乐是生成的，我们根据关键词匹配情绪或流派
        matched_genres = []
        for genre, keywords in {
            "electronic": ["电子", "electronic", "dance", "techno"],
            "ambient": [" ambient", "环境", "relax", "calm"],
            "classical": ["古典", "classical", "piano", "orchestra"],
            "rock": ["摇滚", "rock", "guitar", "band"],
            "pop": ["流行", "pop", "vocal", "song"]
        }.items():
            for keyword in keywords:
                if keyword in query_lower:
                    matched_genres.append(genre)
                    break
        
        if not matched_genres:
            matched_genres = ["electronic"]
        
        # 生成匹配的SoundHelix音乐
        soundhelix_config = self.music_sources["soundhelix"]
        for i in range(1, min(soundhelix_config["range"][1] + 1, limit + 1)):
            track = Track(
                id=f"soundhelix_{i}",
                title=f"SoundHelix {matched_genres[0]} Song {i}",
                artist="SoundHelix",
                album="Generated Music",
                duration=180,
                url="",
                stream_url=f"{soundhelix_config['base_url']}/{soundhelix_config['format'].format(i)}",
                genre=matched_genres[0],
                cover_image=None
            )
            results.append(track)
        
        return results

    async def get_music_from_source(self, source_name: str, limit: int = 10) -> List[Track]:
        """从指定源获取音乐"""
        results = []
        
        if source_name == "soundhelix":
            # 从SoundHelix获取音乐
            source_config = self.music_sources[source_name]
            for i in range(1, min(limit + 1, source_config["range"][1] + 1)):
                track = Track(
                    id=f"soundhelix_{i}",
                    title=f"SoundHelix Song {i}",
                    artist="SoundHelix",
                    album="Generated Music",
                    duration=180,
                    url="",
                    stream_url=f"{source_config['base_url']}/{source_config['format'].format(i)}",
                    genre="various",
                    cover_image=None
                )
                results.append(track)
        
        return results

    def get_playlist_info(self) -> Optional[Dict[str, Any]]:
        """获取播放列表信息"""
        if not self.current_playlist:
            return None

        return {
            "id": self.current_playlist.id,
            "name": self.current_playlist.name,
            "emotion": self.current_playlist.emotion.value if self.current_playlist.emotion else None,
            "total_tracks": len(self.current_playlist.tracks),
            "current_track_index": self.current_track_index,
            "is_playing": self.is_playing,
            "volume": self.volume
        }


def get_music_player_service():
    """获取音乐播放器服务实例，确保在适当的事件循环中启动后台任务"""
    service = MusicPlayerService()

    # 在有事件循环的上下文中启动后台任务
    try:
        loop = asyncio.get_running_loop()
        service.auto_update_task = loop.create_task(service._auto_update_music_sources())
        service.validation_task = loop.create_task(service._validate_all_music_sources())
    except RuntimeError:
        # 如果没有运行的事件循环，则稍后启动任务
        pass

    return service


music_player_service = get_music_player_service()