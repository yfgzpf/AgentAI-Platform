#!/usr/bin/env python3
"""
TTS Handler — 文本转语音
支持 edge-tts (微软免费语音) 和本地 pyttsx3 fallback
"""

import json
import sys
import os
import tempfile


def tts_edge_tts(text, voice, output_path):
    """使用 edge-tts 生成语音 (微软 Edge 免费 TTS)"""
    try:
        import subprocess
        # edge-tts 命令行工具: pip install edge-tts
        cmd = ['edge-tts', '--voice', voice, '--text', text, '--write-media', output_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0 and os.path.getsize(output_path) > 0:
            return True, None
        return False, result.stderr or 'edge-tts failed'
    except FileNotFoundError:
        return False, '请安装 edge-tts: pip install edge-tts'
    except subprocess.TimeoutExpired:
        return False, 'TTS 超时 (60s)'


def tts_pyttsx3(text, output_path):
    """使用 pyttsx3 离线生成语音"""
    try:
        import pyttsx3
        engine = pyttsx3.init()
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return True, None
        return False, 'pyttsx3 生成失败'
    except ImportError:
        return False, '请安装 pyttsx3: pip install pyttsx3'
    except Exception as e:
        return False, str(e)


def main():
    try:
        input_data = json.load(sys.stdin)
        text = input_data.get('text', '')
        voice = input_data.get('voice', 'zh-CN-XiaoxiaoNeural')
        engine = input_data.get('engine', 'edge-tts')
        output_path = input_data.get('output_path', '')

        if not text:
            print(json.dumps({
                'success': False,
                'output': 'Missing required parameter: text'
            }))
            return

        if not output_path:
            output_path = os.path.join(tempfile.gettempdir(), f'tts_output_{os.getpid()}.mp3')

        if engine == 'edge-tts':
            ok, error = tts_edge_tts(text, voice, output_path)
        elif engine == 'pyttsx3':
            ok, error = tts_pyttsx3(text, output_path)
        else:
            print(json.dumps({
                'success': False,
                'output': f'不支持的引擎: {engine} (可选: edge-tts, pyttsx3)'
            }))
            return

        if ok:
            size_kb = os.path.getsize(output_path) / 1024
            print(json.dumps({
                'success': True,
                'output': f"语音生成成功: {output_path} ({size_kb:.1f} KB, 语音: {voice})",
                'data': {
                    'path': output_path,
                    'size_kb': round(size_kb, 1),
                    'voice': voice,
                    'engine': engine,
                    'text_length': len(text)
                }
            }))
        else:
            print(json.dumps({
                'success': False,
                'output': f'TTS 失败: {error}'
            }))

    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))

if __name__ == '__main__':
    main()
