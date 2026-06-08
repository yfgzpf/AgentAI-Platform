"""
情感TTS服务
根据情绪类型生成带有情感色彩的语音
"""
import os
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional
import uuid
import logging

from .emotion_recognition_service import EmotionType

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EmotionalTTSService:
    """情感TTS服务"""

    def __init__(self):
        self.output_dir = Path("data/emotional_tts_output")
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.emotion_voice_mapping = {
            EmotionType.HAPPY: {
                "default_voice": "qwen3-cheerful",
                "pitch_range": (1.1, 1.3),
                "rate_range": (1.05, 1.15),
                "volume_range": (0.95, 1.05)
            },
            EmotionType.SAD: {
                "default_voice": "qwen3-gentle",
                "pitch_range": (0.85, 0.95),
                "rate_range": (0.85, 0.95),
                "volume_range": (0.8, 0.9)
            },
            EmotionType.ANGRY: {
                "default_voice": "qwen3-calm",
                "pitch_range": (0.95, 1.05),
                "rate_range": (0.95, 1.05),
                "volume_range": (0.9, 1.0)
            },
            EmotionType.PAIN: {
                "default_voice": "qwen3-gentle",
                "pitch_range": (0.8, 0.9),
                "rate_range": (0.8, 0.9),
                "volume_range": (0.75, 0.85)
            },
            EmotionType.ANXIOUS: {
                "default_voice": "qwen3-calm",
                "pitch_range": (0.9, 1.0),
                "rate_range": (0.9, 1.0),
                "volume_range": (0.85, 0.95)
            },
            EmotionType.FEAR: {
                "default_voice": "qwen3-gentle",
                "pitch_range": (0.85, 0.95),
                "rate_range": (0.85, 0.95),
                "volume_range": (0.8, 0.9)
            },
            EmotionType.SURPRISE: {
                "default_voice": "qwen3-neutral",
                "pitch_range": (1.05, 1.15),
                "rate_range": (1.0, 1.1),
                "volume_range": (0.95, 1.05)
            },
            EmotionType.DISGUST: {
                "default_voice": "qwen3-neutral",
                "pitch_range": (0.95, 1.05),
                "rate_range": (0.95, 1.05),
                "volume_range": (0.9, 1.0)
            },
            EmotionType.CALM: {
                "default_voice": "qwen3-neutral",
                "pitch_range": (0.95, 1.05),
                "rate_range": (0.95, 1.05),
                "volume_range": (0.95, 1.05)
            },
            EmotionType.CONFUSED: {
                "default_voice": "qwen3-neutral",
                "pitch_range": (0.9, 1.0),
                "rate_range": (0.9, 1.0),
                "volume_range": (0.9, 1.0)
            }
        }

        self.emotion_pronunciation_rules = {
            EmotionType.HAPPY: {
                "intonation": "rising",
                "emphasis": "positive",
                "pauses": "short"
            },
            EmotionType.SAD: {
                "intonation": "falling",
                "emphasis": "gentle",
                "pauses": "long"
            },
            EmotionType.ANGRY: {
                "intonation": "flat",
                "emphasis": "controlled",
                "pauses": "medium"
            },
            EmotionType.PAIN: {
                "intonation": "falling",
                "emphasis": "soft",
                "pauses": "long"
            },
            EmotionType.ANXIOUS: {
                "intonation": "wavering",
                "emphasis": "reassuring",
                "pauses": "medium"
            },
            EmotionType.FEAR: {
                "intonation": "falling",
                "emphasis": "gentle",
                "pauses": "long"
            },
            EmotionType.SURPRISE: {
                "intonation": "rising",
                "emphasis": "neutral",
                "pauses": "short"
            },
            EmotionType.DISGUST: {
                "intonation": "falling",
                "emphasis": "neutral",
                "pauses": "medium"
            },
            EmotionType.CALM: {
                "intonation": "neutral",
                "emphasis": "balanced",
                "pauses": "medium"
            },
            EmotionType.CONFUSED: {
                "intonation": "wavering",
                "emphasis": "clarifying",
                "pauses": "medium"
            }
        }

    async def synthesize_emotional_speech(
        self,
        text: str,
        emotion: EmotionType,
        intensity: float = 0.5,
        voice_id: Optional[str] = None,
        custom_parameters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        合成情感语音

        Args:
            text: 要合成的文本
            emotion: 情绪类型
            intensity: 情绪强度 0-1
            voice_id: 音色ID（可选）
            custom_parameters: 自定义TTS参数（可选）

        Returns:
            合成结果
        """
        try:
            emotion_config = self.emotion_voice_mapping.get(
                emotion,
                self.emotion_voice_mapping[EmotionType.CALM]
            )

            pronunciation_rules = self.emotion_pronunciation_rules.get(
                emotion,
                self.emotion_pronunciation_rules[EmotionType.CALM]
            )

            if not voice_id:
                voice_id = emotion_config["default_voice"]

            pitch_range = emotion_config["pitch_range"]
            rate_range = emotion_config["rate_range"]
            volume_range = emotion_config["volume_range"]

            pitch = pitch_range[0] + (pitch_range[1] - pitch_range[0]) * intensity
            rate = rate_range[0] + (rate_range[1] - rate_range[0]) * intensity
            volume = volume_range[0] + (volume_range[1] - volume_range[0]) * intensity

            if custom_parameters:
                pitch = custom_parameters.get("pitch", pitch)
                rate = custom_parameters.get("rate", rate)
                volume = custom_parameters.get("volume", volume)

            processed_text = self._apply_pronunciation_rules(
                text,
                pronunciation_rules
            )

            output_filename = f"{emotion.value}_{uuid.uuid4()}.wav"
            output_path = self.output_dir / output_filename

            synthesis_result = await self._call_tts_service(
                processed_text,
                voice_id,
                pitch,
                rate,
                volume,
                output_path
            )

            if synthesis_result["success"]:
                duration = len(text) * 0.15 * (2.0 - rate)

                return {
                    "success": True,
                    "audio_url": f"/api/v1/emotion/audio/{output_filename}",
                    "duration": duration,
                    "emotion": emotion.value,
                    "intensity": intensity,
                    "voice_id": voice_id,
                    "tts_parameters": {
                        "pitch": pitch,
                        "rate": rate,
                        "volume": volume
                    },
                    "pronunciation_rules": pronunciation_rules,
                    "message": "情感语音合成成功"
                }
            else:
                return synthesis_result

        except Exception as e:
            logger.error(f"情感语音合成失败: {str(e)}")
            return {
                "success": False,
                "message": f"情感语音合成失败: {str(e)}",
                "error": str(e)
            }

    def _apply_pronunciation_rules(
        self,
        text: str,
        rules: Dict[str, str]
    ) -> str:
        """
        应用发音规则

        Args:
            text: 原始文本
            rules: 发音规则

        Returns:
            处理后的文本
        """
        processed_text = text

        if rules["pauses"] == "long":
            processed_text = processed_text.replace("，", "，...").replace("。", "。。。")
        elif rules["pauses"] == "short":
            processed_text = processed_text.replace("，", ",").replace("。", "。")
        elif rules["pauses"] == "medium":
            processed_text = processed_text.replace("，", "，,").replace("。", "。。")

        return processed_text

    async def _call_tts_service(
        self,
        text: str,
        voice_id: str,
        pitch: float,
        rate: float,
        volume: float,
        output_path: Path
    ) -> Dict[str, Any]:
        """
        调用TTS服务

        Args:
            text: 文本
            voice_id: 音色ID
            pitch: 音调
            rate: 语速
            volume: 音量
            output_path: 输出路径

        Returns:
            合成结果
        """
        try:
            from services.qwen3_tts_service import qwen3_tts_service

            result = await qwen3_tts_service.synthesize(
                text=text,
                voice_id=voice_id,
                rate=rate,
                pitch=pitch,
                volume=volume
            )

            if result["success"]:
                import shutil
                source_path = result.get("output_path")
                if source_path and os.path.exists(source_path):
                    shutil.move(source_path, output_path)
                    result["output_path"] = str(output_path)

            return result

        except Exception as e:
            logger.error(f"调用TTS服务失败: {str(e)}")
            return {
                "success": False,
                "message": f"调用TTS服务失败: {str(e)}",
                "error": str(e)
            }

    async def batch_synthesize(
        self,
        texts: list[str],
        emotion: EmotionType,
        intensity: float = 0.5,
        voice_id: Optional[str] = None
    ) -> list[Dict[str, Any]]:
        """
        批量合成情感语音

        Args:
            texts: 文本列表
            emotion: 情绪类型
            intensity: 情绪强度
            voice_id: 音色ID

        Returns:
            合成结果列表
        """
        tasks = [
            self.synthesize_emotional_speech(
                text=text,
                emotion=emotion,
                intensity=intensity,
                voice_id=voice_id
            )
            for text in texts
        ]

        return await asyncio.gather(*tasks)

    def get_supported_emotions(self) -> list[Dict[str, Any]]:
        """
        获取支持的情绪列表

        Returns:
            情绪列表
        """
        emotions = []
        for emotion_type, config in self.emotion_voice_mapping.items():
            pronunciation = self.emotion_pronunciation_rules.get(emotion_type, {})

            emotions.append({
                "emotion": emotion_type.value,
                "name": emotion_type.name,
                "default_voice": config["default_voice"],
                "pitch_range": config["pitch_range"],
                "rate_range": config["rate_range"],
                "volume_range": config["volume_range"],
                "pronunciation_rules": pronunciation
            })

        return emotions

    def get_emotion_presets(self) -> Dict[str, Dict[str, Any]]:
        """
        获取情绪预设

        Returns:
            情绪预设字典
        """
        presets = {}
        for emotion_type, config in self.emotion_voice_mapping.items():
            pronunciation = self.emotion_pronunciation_rules.get(emotion_type, {})

            presets[emotion_type.value] = {
                "voice_id": config["default_voice"],
                "pitch": (config["pitch_range"][0] + config["pitch_range"][1]) / 2,
                "rate": (config["rate_range"][0] + config["rate_range"][1]) / 2,
                "volume": (config["volume_range"][0] + config["volume_range"][1]) / 2,
                "pronunciation_rules": pronunciation
            }

        return presets


emotional_tts_service = EmotionalTTSService()
