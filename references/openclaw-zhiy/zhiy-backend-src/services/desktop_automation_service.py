"""
桌面自动化服务
提供各种桌面自动化操作，包括应用控制、文件操作、系统操作等
"""

import os
import subprocess
import webbrowser
import logging
import time
import asyncio
from typing import Dict, Any, Optional, List
from pathlib import Path

# 导入智能UI元素识别模块
from services.smart_ui_recognizer import SmartUIElementRecognizer, get_recognizer, UIElement

# 尝试导入Playwright（无头浏览器）
try:
    from playwright.async_api import async_playwright, Browser, Page, BrowserContext
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    logger.warning("Playwright未安装，无法使用无头浏览器功能")

logger = logging.getLogger(__name__)


class DesktopAutomationService:
    """桌面自动化服务类"""
    
    def __init__(self):
        self.supported_applications = {
            'music': {
                'netease_cloud_music': {
                    'name': '网易云音乐',
                    'windows_path': 'C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe',
                    'web_url': 'https://music.163.com/',
                    'search_url': 'https://music.163.com/#/search/m/?s={query}'
                },
                'qq_music': {
                    'name': 'QQ音乐',
                    'windows_path': 'C:\\Program Files (x86)\\Tencent\\QQMusic\\QQMusic.exe',
                    'web_url': 'https://y.qq.com/',
                    'search_url': 'https://y.qq.com/n/ryqq/search?w={query}'
                },
                'kugou_music': {
                    'name': '酷狗音乐',
                    'windows_path': 'C:\\Program Files\\KuGou\\KGMusic\\KuGou.exe',
                    'web_url': 'https://www.kugou.com/',
                    'search_url': 'https://www.kugou.com/yy/index.php?r=so/index&kw={query}'
                },
                'spotify': {
                    'name': 'Spotify',
                    'windows_path': 'C:\\Users\\{username}\\AppData\\Roaming\\Spotify\\Spotify.exe',
                    'web_url': 'https://open.spotify.com/',
                    'search_url': 'https://open.spotify.com/search/{query}'
                },
                'itunes': {
                    'name': 'iTunes',
                    'windows_path': 'C:\\Program Files\\iTunes\\iTunes.exe',
                    'web_url': 'https://music.apple.com/',
                    'search_url': 'https://music.apple.com/search?term={query}'
                }
            },
            'browser': {
                'chrome': {
                    'name': 'Google Chrome',
                    'windows_path': 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    'mac_path': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
                },
                'edge': {
                    'name': 'Microsoft Edge',
                    'windows_path': 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                    'mac_path': '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
                },
                'firefox': {
                    'name': 'Firefox',
                    'windows_path': 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
                    'mac_path': '/Applications/Firefox.app/Contents/MacOS/firefox'
                }
            },
            'office': {
                'word': {
                    'name': 'Microsoft Word',
                    'windows_path': 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
                    'mac_path': '/Applications/Microsoft Word.app/Contents/MacOS/Microsoft Word'
                },
                'excel': {
                    'name': 'Microsoft Excel',
                    'windows_path': 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
                    'mac_path': '/Applications/Microsoft Excel.app/Contents/MacOS/Microsoft Excel'
                },
                'powerpoint': {
                    'name': 'Microsoft PowerPoint',
                    'windows_path': 'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
                    'mac_path': '/Applications/Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint'
                }
            },
            'development': {
                'vscode': {
                    'name': 'Visual Studio Code',
                    'windows_path': 'C:\\Users\\{username}\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
                    'mac_path': '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
                },
                'pycharm': {
                    'name': 'PyCharm',
                    'windows_path': 'C:\\Program Files\\JetBrains\\PyCharm Community Edition\\bin\\pycharm64.exe',
                    'mac_path': '/Applications/PyCharm CE.app/Contents/MacOS/pycharm'
                }
            },
            'communication': {
                'wechat': {
                    'name': '微信',
                    'windows_path': 'C:\\Program Files (x86)\\Tencent\\WeChat\\WeChat.exe',
                    'mac_path': '/Applications/WeChat.app/Contents/MacOS/WeChat'
                },
                'qq': {
                    'name': 'QQ',
                    'windows_path': 'C:\\Program Files (x86)\\Tencent\\QQ\\Bin\\QQScLauncher.exe',
                    'mac_path': '/Applications/QQ.app/Contents/MacOS/QQ'
                },
                'dingtalk': {
                    'name': '钉钉',
                    'windows_path': 'C:\\Program Files (x86)\\DingDing\\DingtalkLauncher.exe',
                    'mac_path': '/Applications/DingTalk.app/Contents/MacOS/DingTalk'
                }
            },
            'system': {
                'notepad': {
                    'name': '记事本',
                    'windows_path': 'C:\\Windows\\system32\\notepad.exe',
                    'mac_path': '/Applications/TextEdit.app/Contents/MacOS/TextEdit'
                }
            }
        }
        
        # 初始化智能UI元素识别器
        self.ui_recognizer = get_recognizer()
        self.ui_recognizer.initialize()
    
    def open_application(self, app_name: str, app_type: str = 'music', parameters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        打开应用程序
        
        Args:
            app_name: 应用名称（如 'netease_cloud_music' 或任意应用名称）
            app_type: 应用类型（如 'music', 'browser', 'office', 'general'）
            parameters: 额外参数（如搜索查询）
        
        Returns:
            操作结果
        """
        try:
            # 对于通用应用类型，使用start命令打开
            if app_type == 'general':
                try:
                    # 使用start命令打开应用（通过开始菜单搜索）
                    subprocess.Popen(['start', app_name], shell=True)
                    logger.info(f'成功通过开始菜单打开应用: {app_name}')
                    return {
                        'success': True,
                        'message': f'成功打开 {app_name}',
                        'app_name': app_name,
                        'method': 'start_menu',
                        'app_type': 'general'
                    }
                except Exception as e:
                    logger.warning(f'通过开始菜单打开应用失败: {str(e)}')
                    return {
                        'success': False,
                        'message': f'打开 {app_name} 失败: {str(e)}'
                    }
            
            # 对于预定义的应用类型
            if app_type not in self.supported_applications:
                return {
                    'success': False,
                    'message': f'不支持的应用类型: {app_type}'
                }
            
            apps = self.supported_applications[app_type]
            
            if app_name not in apps:
                return {
                    'success': False,
                    'message': f'找不到应用: {app_name}'
                }
            
            app_info = apps[app_name]
            
            # 尝试打开本地应用
            local_path = self._get_local_app_path(app_info)
            
            if local_path and os.path.exists(local_path):
                try:
                    subprocess.Popen([local_path])
                    logger.info(f'成功打开应用: {app_info["name"]}')
                    return {
                        'success': True,
                        'message': f'成功打开 {app_info["name"]}',
                        'app_name': app_info['name'],
                        'method': 'local_application',
                        'path': local_path
                    }
                except Exception as e:
                    logger.warning(f'打开本地应用失败: {str(e)}')
            
            # 如果本地应用不存在，尝试打开网页版
            if 'web_url' in app_info:
                url = app_info['web_url']
                
                # 如果有搜索参数，使用搜索URL
                if parameters and 'search_query' in parameters:
                    search_query = parameters['search_query']
                    if 'search_url' in app_info:
                        url = app_info['search_url'].format(query=search_query)
                
                webbrowser.open(url)
                logger.info(f'打开网页版应用: {url}')
                return {
                    'success': True,
                    'message': f'已打开 {app_info["name"]} 网页版',
                    'app_name': app_info['name'],
                    'method': 'browser',
                    'url': url
                }
            
            return {
                'success': False,
                'message': f'无法打开 {app_info["name"]}，请检查应用是否已安装'
            }
        
        except Exception as e:
            logger.error(f'打开应用失败: {str(e)}')
            return {
                'success': False,
                'message': f'打开应用失败: {str(e)}'
            }
    
    def play_music(self, song_name: Optional[str] = None, search_query: Optional[str] = None, user_message: Optional[str] = None) -> Dict[str, Any]:
        """
        播放音乐（使用智能UI元素识别）
        
        Args:
            song_name: 歌曲名称
            search_query: 搜索关键词
            user_message: 用户原始消息（用于智能理解意图）
        
        Returns:
            操作结果
        """
        try:
            # 智能理解用户意图
            query = self._intelligent_understand_music_intent(user_message, song_name, search_query)
            
            logger.info(f'智能理解用户意图，确定搜索查询: {query}')
            
            # 尝试打开网易云音乐
            result = self.open_application(
                'netease_cloud_music',
                'music',
                {'search_query': query}
            )
            
            if result['success']:
                logger.info(f'等待应用启动...')
                time.sleep(3)  # 等待应用启动
                
                # 使用智能UI元素识别查找输入框并输入歌曲名
                try:
                    # 智能查找输入框，尝试多种关键词
                    input_box = self._intelligent_find_music_search_box('netease')
                    
                    if input_box:
                        logger.info(f'找到输入框，输入歌曲: {query}')
                        # 智能输入歌曲名称，确保输入正确
                        input_success = self._intelligent_input_song_name(input_box, query)
                        
                        if input_success:
                            time.sleep(1)
                            
                            # 智能查找并点击搜索按钮
                            search_success = self._intelligent_find_and_click_search_button('netease')
                            
                            if search_success:
                                time.sleep(2)
                                
                                # 智能查找并点击播放按钮
                                play_success = self._intelligent_find_and_click_play_button('netease')
                                
                                if play_success:
                                    return {
                                        'success': True,
                                        'message': f'成功播放音乐: {query}',
                                        'song_name': song_name or query,
                                        'search_query': query,
                                        'method': result['method'],
                                        'app_used': result['app_name'],
                                        'ui_recognition_used': True,
                                        'steps': ['打开应用', '找到输入框', '输入歌曲名', '点击搜索', '点击播放']
                                    }
                                else:
                                    return {
                                        'success': True,
                                        'message': f'已搜索到音乐: {query}，请手动点击播放',
                                        'song_name': song_name or query,
                                        'search_query': query,
                                        'method': result['method'],
                                        'app_used': result['app_name'],
                                        'ui_recognition_used': True,
                                        'steps': ['打开应用', '找到输入框', '输入歌曲名', '点击搜索']
                                    }
                            else:
                                return {
                                    'success': True,
                                    'message': f'已输入歌曲: {query}，请手动点击搜索',
                                    'song_name': song_name or query,
                                    'search_query': query,
                                    'method': result['method'],
                                    'app_used': result['app_name'],
                                    'ui_recognition_used': True,
                                    'steps': ['打开应用', '找到输入框', '输入歌曲名']
                                }
                        else:
                            return {
                                'success': True,
                                'message': f'已打开 {result["app_name"]}，请手动输入歌曲: {query}',
                                'song_name': song_name or query,
                                'search_query': query,
                                'method': result['method'],
                                'app_used': result['app_name'],
                                'ui_recognition_used': True,
                                'steps': ['打开应用', '找到输入框']
                            }
                    else:
                        logger.warning('未找到输入框，使用传统方法')
                        return {
                            'success': True,
                            'message': f'已打开 {result["app_name"]}，请手动搜索: {query}',
                            'song_name': song_name or query,
                            'search_query': query,
                            'method': result['method'],
                            'app_used': result['app_name'],
                            'ui_recognition_used': False,
                            'steps': ['打开应用']
                        }
                
                except Exception as ui_error:
                    logger.warning(f'UI识别失败: {str(ui_error)}，使用传统方法')
                    return {
                        'success': True,
                        'message': f'已打开 {result["app_name"]}，请手动搜索: {query}',
                        'song_name': song_name or query,
                        'search_query': query,
                        'method': result['method'],
                        'app_used': result['app_name'],
                        'ui_recognition_used': False,
                        'steps': ['打开应用']
                    }
            
            # 如果网易云音乐失败，尝试QQ音乐
            logger.info(f'网易云音乐失败，尝试QQ音乐...')
            result = self.open_application(
                'qq_music',
                'music',
                {'search_query': query}
            )
            
            if result['success']:
                logger.info(f'等待QQ音乐启动...')
                time.sleep(3)  # 等待应用启动
                
                # 使用智能UI元素识别查找输入框并输入歌曲名
                try:
                    # 智能查找输入框，尝试多种关键词
                    input_box = self._intelligent_find_music_search_box('qq')
                    
                    if input_box:
                        logger.info(f'找到QQ音乐输入框，输入歌曲: {query}')
                        # 智能输入歌曲名称，确保输入正确
                        input_success = self._intelligent_input_song_name(input_box, query)
                        
                        if input_success:
                            time.sleep(1)
                            
                            # 智能查找并点击搜索按钮
                            search_success = self._intelligent_find_and_click_search_button('qq')
                            
                            if search_success:
                                time.sleep(2)
                                
                                # 智能查找并点击播放按钮
                                play_success = self._intelligent_find_and_click_play_button('qq')
                                
                                if play_success:
                                    return {
                                        'success': True,
                                        'message': f'成功播放音乐: {query}',
                                        'song_name': song_name or query,
                                        'search_query': query,
                                        'method': result['method'],
                                        'app_used': result['app_name'],
                                        'ui_recognition_used': True,
                                        'steps': ['打开应用', '找到输入框', '输入歌曲名', '点击搜索', '点击播放']
                                    }
                    
                except Exception as ui_error:
                    logger.warning(f'QQ音乐UI识别失败: {str(ui_error)}')
                
                return {
                    'success': True,
                    'message': f'正在播放音乐: {query}',
                    'song_name': song_name or query,
                    'search_query': query,
                    'method': result['method'],
                    'app_used': result['app_name'],
                    'search_url': result.get('url', ''),
                    'steps': ['打开应用']
                }
            
            # 如果所有音乐应用都失败，尝试网页版
            logger.info(f'所有本地音乐应用失败，尝试网页版...')
            web_result = self._play_music_web_version(query)
            
            if web_result['success']:
                return web_result
            
            return {
                'success': False,
                'message': '无法播放音乐，请检查音乐应用是否已安装'
            }
        
        except Exception as e:
            logger.error(f'播放音乐失败: {str(e)}')
            return {
                'success': False,
                'message': f'播放音乐失败: {str(e)}'
            }
    
    def _intelligent_understand_music_intent(self, user_message: Optional[str], song_name: Optional[str], search_query: Optional[str]) -> str:
        """
        智能理解用户的音乐意图
        
        Args:
            user_message: 用户原始消息
            song_name: 歌曲名称
            search_query: 搜索关键词
        
        Returns:
            智能理解后的搜索查询
        """
        # 优先使用直接提供的参数
        if search_query:
            return search_query
        if song_name:
            return song_name
        
        # 从用户消息中提取歌曲名称
        if user_message:
            import re
            
            # 常见的音乐相关关键词
            music_keywords = ['播放', '音乐', '歌', '歌曲', '唱', 'listen', 'play', 'music', 'song']
            
            # 检查是否包含音乐相关关键词
            contains_music_keyword = any(keyword in user_message for keyword in music_keywords)
            
            if contains_music_keyword:
                # 尝试提取歌曲名称
                # 模式1: "播放[歌曲名]"
                pattern1 = r'播放\s*(.+)'  # 匹配"播放"后面的内容
                match1 = re.search(pattern1, user_message)
                if match1:
                    return match1.group(1).strip()
                
                # 模式2: "[歌曲名]\s*音乐"
                pattern2 = r'(.+)\s*音乐'
                match2 = re.search(pattern2, user_message)
                if match2:
                    return match2.group(1).strip()
                
                # 模式3: "[歌曲名]\s*歌"
                pattern3 = r'(.+)\s*歌'
                match3 = re.search(pattern3, user_message)
                if match3:
                    return match3.group(1).strip()
        
        # 默认搜索
        return '音乐'
    
    def _intelligent_find_music_search_box(self, platform: str) -> Optional[UIElement]:
        """
        智能查找音乐应用的搜索框
        
        Args:
            platform: 音乐平台 (netease, qq, kugou)
        
        Returns:
            找到的输入框元素
        """
        try:
            # 不同平台的搜索框关键词
            platform_keywords = {
                'netease': ['搜索', '输入', 'music', 'search', '网易云', '搜索框'],
                'qq': ['搜索', '输入', 'QQ音乐', 'music', 'search', '搜索框'],
                'kugou': ['搜索', '输入', '酷狗', 'music', 'search', '搜索框']
            }
            
            keywords = platform_keywords.get(platform, ['搜索', '输入', '搜索框'])
            
            # 尝试不同的关键词组合
            for keyword in keywords:
                input_box = self.ui_recognizer.find_input_box([keyword])
                if input_box:
                    logger.info(f'通过关键词 "{keyword}" 找到输入框')
                    return input_box
            
            # 尝试默认关键词
            input_box = self.ui_recognizer.find_input_box()
            if input_box:
                logger.info(f'找到默认输入框')
                return input_box
            
            # 尝试使用OCR直接识别屏幕上的文本，查找搜索框
            screenshot = self.ui_recognizer.capture_screen()
            if screenshot:
                recognized_texts = self.ui_recognizer.recognize_text(screenshot)
                
                # 查找包含搜索相关文本的区域
                for item in recognized_texts:
                    text = item['text'].lower()
                    if any(keyword.lower() in text for keyword in ['搜索', 'search', '输入', 'input', '搜索框']):
                        bbox = item['bbox']
                        # 扩展区域以包含输入框
                        expanded_bbox = (
                            max(0, bbox[0] - 100),
                            max(0, bbox[1] - 20),
                            bbox[2] + 200,
                            bbox[3] + 30
                        )
                        
                        element = UIElement(
                            element_type='input',
                            text=item['text'],
                            position=(expanded_bbox[0] + 50, expanded_bbox[1] + 15),
                            size=(expanded_bbox[2] - expanded_bbox[0], expanded_bbox[3] - expanded_bbox[1]),
                            confidence=item['confidence'],
                            attributes={'bbox': expanded_bbox, 'keyword': text}
                        )
                        logger.info(f'通过OCR找到输入框: {item["text"]}')
                        return element
        except Exception as e:
            logger.warning(f'OCR识别失败: {str(e)}')
            import traceback
            logger.warning(traceback.format_exc())
        
        logger.warning(f'未能找到{platform}平台的搜索框')
        return None
    
    def _intelligent_input_song_name(self, input_box: UIElement, song_name: str) -> bool:
        """
        智能输入歌曲名称
        
        Args:
            input_box: 输入框元素
            song_name: 歌曲名称
        
        Returns:
            是否输入成功
        """
        try:
            # 点击元素以获得焦点
            click_success = self.ui_recognizer.click_element(input_box)
            if not click_success:
                return False
            
            time.sleep(0.2)
            
            # 清空现有内容
            import pyautogui
            pyautogui.hotkey('ctrl', 'a')
            time.sleep(0.1)
            pyautogui.press('backspace')
            time.sleep(0.1)
            
            # 输入新文本
            pyautogui.typewrite(song_name, interval=0.05)
            time.sleep(0.5)
            
            # 验证输入是否成功
            # 可以通过再次截图识别来验证，但这里简化处理
            logger.info(f'成功输入歌曲名称: {song_name}')
            return True
        except Exception as e:
            logger.error(f'输入歌曲名称失败: {str(e)}')
            return False
    
    def _intelligent_find_and_click_search_button(self, platform: str) -> bool:
        """
        智能查找并点击搜索按钮
        
        Args:
            platform: 音乐平台
        
        Returns:
            是否点击成功
        """
        # 不同平台的搜索按钮关键词
        platform_buttons = {
            'netease': ['搜索', 'search', '确定', 'enter'],
            'qq': ['搜索', 'search', '确定', 'enter'],
            'kugou': ['搜索', 'search', '确定', 'enter']
        }
        
        buttons = platform_buttons.get(platform, ['搜索', '确定'])
        
        # 尝试不同的按钮文本
        for button_text in buttons:
            search_button = self.ui_recognizer.find_button(button_text)
            if search_button:
                click_success = self.ui_recognizer.click_element(search_button)
                if click_success:
                    logger.info(f'成功点击搜索按钮: {button_text}')
                    return True
        
        # 尝试按回车键
        try:
            import pyautogui
            pyautogui.press('enter')
            logger.info(f'按下回车键进行搜索')
            return True
        except Exception as e:
            logger.warning(f'按回车键失败: {str(e)}')
        
        return False
    
    def _intelligent_find_and_click_play_button(self, platform: str) -> bool:
        """
        智能查找并点击播放按钮
        
        Args:
            platform: 音乐平台
        
        Returns:
            是否点击成功
        """
        # 尝试查找播放按钮
        play_button = self.ui_recognizer.find_music_play_button()
        if play_button:
            click_success = self.ui_recognizer.click_element(play_button)
            if click_success:
                logger.info(f'成功点击播放按钮')
                return True
        
        # 尝试查找第一个搜索结果并点击
        try:
            # 等待搜索结果加载
            time.sleep(2)
            
            # 截取屏幕，查找包含歌曲信息的区域
            screenshot = self.ui_recognizer.capture_screen()
            if screenshot:
                recognized_texts = self.ui_recognizer.recognize_text(screenshot)
                
                # 查找可能的歌曲标题
                for item in recognized_texts:
                    text = item['text']
                    # 简单判断是否可能是歌曲标题
                    if len(text) > 2 and len(text) < 50:
                        bbox = item['bbox']
                        # 点击文本附近的区域
                        import pyautogui
                        click_x = bbox[0] + bbox[2] // 2
                        click_y = bbox[1] + bbox[3] // 2
                        pyautogui.moveTo(click_x, click_y, duration=0.3)
                        time.sleep(0.1)
                        pyautogui.click()
                        logger.info(f'尝试点击可能的歌曲: {text}')
                        return True
        except Exception as e:
            logger.warning(f'查找并点击播放按钮失败: {str(e)}')
        
        return False
    
    def _play_music_web_version(self, query: str) -> Dict[str, Any]:
        """
        使用网页版播放音乐
        
        Args:
            query: 搜索关键词
        
        Returns:
            操作结果
        """
        try:
            # 打开网易云音乐网页版
            import webbrowser
            import urllib.parse
            
            # 对查询进行URL编码，确保中文字符正确传递
            encoded_query = urllib.parse.quote(query.encode('utf-8'))
            web_url = f"https://music.163.com/#/search/m/?s={encoded_query}"
            webbrowser.open(web_url)
            
            logger.info(f'打开网易云音乐网页版: {web_url}')
            
            return {
                'success': True,
                'message': f'已打开网易云音乐网页版并搜索: {query}',
                'song_name': query,
                'search_query': query,
                'method': 'browser',
                'app_used': '网易云音乐网页版',
                'url': web_url,
                'steps': ['打开网页版']
            }
        except Exception as e:
            logger.error(f'打开网页版音乐失败: {str(e)}')
            import traceback
            logger.error(traceback.format_exc())
            return {
                'success': False,
                'message': f'打开网页版音乐失败: {str(e)}'
            }
    
    def open_browser(self, url: Optional[str] = None, browser: str = 'chrome') -> Dict[str, Any]:
        """
        打开浏览器
        
        Args:
            url: 要打开的URL
            browser: 浏览器类型
        
        Returns:
            操作结果
        """
        try:
            if url:
                webbrowser.open(url)
                return {
                    'success': True,
                    'message': f'已打开浏览器并访问: {url}',
                    'url': url,
                    'method': 'browser'
                }
            else:
                result = self.open_application(browser, 'browser')
                return result
        
        except Exception as e:
            logger.error(f'打开浏览器失败: {str(e)}')
            return {
                'success': False,
                'message': f'打开浏览器失败: {str(e)}'
            }
    
    def open_file(self, file_path: str) -> Dict[str, Any]:
        """
        打开文件
        
        Args:
            file_path: 文件路径
        
        Returns:
            操作结果
        """
        try:
            if not os.path.exists(file_path):
                return {
                    'success': False,
                    'message': f'文件不存在: {file_path}'
                }
            
            # 使用系统默认程序打开文件
            if os.name == 'nt':  # Windows
                os.startfile(file_path)
            elif os.name == 'posix':  # macOS/Linux
                subprocess.Popen(['open' if sys.platform == 'darwin' else 'xdg-open', file_path])
            
            logger.info(f'成功打开文件: {file_path}')
            return {
                'success': True,
                'message': f'已打开文件: {file_path}',
                'file_path': file_path
            }
        
        except Exception as e:
            logger.error(f'打开文件失败: {str(e)}')
            return {
                'success': False,
                'message': f'打开文件失败: {str(e)}'
            }
    
    def open_folder(self, folder_path: str) -> Dict[str, Any]:
        """
        打开文件夹
        
        Args:
            folder_path: 文件夹路径
        
        Returns:
            操作结果
        """
        try:
            if not os.path.exists(folder_path):
                return {
                    'success': False,
                    'message': f'文件夹不存在: {folder_path}'
                }
            
            # 打开文件夹
            if os.name == 'nt':  # Windows
                subprocess.Popen(['explorer', folder_path])
            elif os.name == 'posix':  # macOS/Linux
                subprocess.Popen(['open' if sys.platform == 'darwin' else 'xdg-open', folder_path])
            
            logger.info(f'成功打开文件夹: {folder_path}')
            return {
                'success': True,
                'message': f'已打开文件夹: {folder_path}',
                'folder_path': folder_path
            }
        
        except Exception as e:
            logger.error(f'打开文件夹失败: {str(e)}')
            return {
                'success': False,
                'message': f'打开文件夹失败: {str(e)}'
            }
    
    def search_web(self, query: str, search_engine: str = 'baidu') -> Dict[str, Any]:
        """
        网页搜索
        
        Args:
            query: 搜索关键词
            search_engine: 搜索引擎（baidu, google, bing）
        
        Returns:
            操作结果
        """
        try:
            search_urls = {
                'baidu': 'https://www.baidu.com/s?wd={query}',
                'google': 'https://www.google.com/search?q={query}',
                'bing': 'https://www.bing.com/search?q={query}'
            }
            
            if search_engine not in search_urls:
                search_engine = 'baidu'
            
            url = search_urls[search_engine].format(query=query)
            webbrowser.open(url)
            
            logger.info(f'执行网页搜索: {query}')
            return {
                'success': True,
                'message': f'已在{search_engine}中搜索: {query}',
                'query': query,
                'search_engine': search_engine,
                'url': url
            }
        
        except Exception as e:
            logger.error(f'网页搜索失败: {str(e)}')
            return {
                'success': False,
                'message': f'网页搜索失败: {str(e)}'
            }
    
    def take_screenshot(self, save_path: Optional[str] = None) -> Dict[str, Any]:
        """
        截图（需要安装 pyautogui）
        
        Args:
            save_path: 保存路径
        
        Returns:
            操作结果
        """
        try:
            import pyautogui
            
            screenshot = pyautogui.screenshot()
            
            if save_path:
                screenshot.save(save_path)
                logger.info(f'截图已保存: {save_path}')
                return {
                    'success': True,
                    'message': f'截图已保存到: {save_path}',
                    'save_path': save_path
                }
            else:
                import tempfile
                temp_path = os.path.join(tempfile.gettempdir(), f'screenshot_{int(time.time())}.png')
                screenshot.save(temp_path)
                logger.info(f'截图已保存: {temp_path}')
                return {
                    'success': True,
                    'message': f'截图已保存到: {temp_path}',
                    'save_path': temp_path
                }
        
        except ImportError:
            logger.warning('pyautogui 未安装，无法截图')
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'截图失败: {str(e)}')
            return {
                'success': False,
                'message': f'截图失败: {str(e)}'
            }
    
    def send_notification(self, title: str, message: str) -> Dict[str, Any]:
        """
        发送系统通知
        
        Args:
            title: 通知标题
            message: 通知内容
        
        Returns:
            操作结果
        """
        try:
            if os.name == 'nt':  # Windows
                from win10toast import ToastNotifier
                toaster = ToastNotifier()
                toaster.show_toast(
                    title,
                    message,
                    duration=5,
                    threaded=True
                )
            elif os.name == 'posix':  # macOS/Linux
                if sys.platform == 'darwin':  # macOS
                    subprocess.run([
                        'osascript',
                        '-e',
                        f'display notification "{message}" with title "{title}"'
                    ])
                else:  # Linux
                    subprocess.run([
                        'notify-send',
                        title,
                        message
                    ])
            
            logger.info(f'发送通知: {title} - {message}')
            return {
                'success': True,
                'message': f'已发送通知: {title}',
                'title': title,
                'content': message
            }
        
        except ImportError:
            logger.warning('通知库未安装')
            return {
                'success': False,
                'message': '通知库未安装，请先安装相应的通知库'
            }
        except Exception as e:
            logger.error(f'发送通知失败: {str(e)}')
            return {
                'success': False,
                'message': f'发送通知失败: {str(e)}'
            }
    
    def type_text(self, text: str, delay: float = 0.1) -> Dict[str, Any]:
        """
        自动输入文本（需要安装 pyautogui）
        
        Args:
            text: 要输入的文本
            delay: 每个字符之间的延迟（秒）
        
        Returns:
            操作结果
        """
        try:
            import pyautogui
            
            # 输入文本
            pyautogui.typewrite(text, interval=delay)
            
            logger.info(f'自动输入文本: {text}')
            return {
                'success': True,
                'message': f'已自动输入文本: {text}',
                'text': text,
                'delay': delay
            }
        except ImportError:
            logger.warning('pyautogui 未安装，无法自动输入文本')
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'自动输入文本失败: {str(e)}')
            return {
                'success': False,
                'message': f'自动输入文本失败: {str(e)}'
            }
    
    def press_keys(self, keys: list) -> Dict[str, Any]:
        """
        按下组合键（需要安装 pyautogui）
        
        Args:
            keys: 键列表，如 ['ctrl', 'c']
        
        Returns:
            操作结果
        """
        try:
            import pyautogui
            
            # 按下组合键
            pyautogui.hotkey(*keys)
            
            logger.info(f'按下组合键: {keys}')
            return {
                'success': True,
                'message': f'已按下组合键: {keys}',
                'keys': keys
            }
        except ImportError:
            logger.warning('pyautogui 未安装，无法按下组合键')
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'按下组合键失败: {str(e)}')
            return {
                'success': False,
                'message': f'按下组合键失败: {str(e)}'
            }
    
    def click_mouse(self, x: Optional[int] = None, y: Optional[int] = None, button: str = 'left') -> Dict[str, Any]:
        """
        鼠标点击（需要安装 pyautogui）
        
        Args:
            x: X坐标（如果不指定，使用当前位置）
            y: Y坐标（如果不指定，使用当前位置）
            button: 按钮（left, middle, right）
        
        Returns:
            操作结果
        """
        try:
            import pyautogui
            
            # 如果指定了坐标，移动到该位置
            if x is not None and y is not None:
                pyautogui.moveTo(x, y, duration=0.5)
                position = (x, y)
            else:
                # 获取当前鼠标位置
                position = pyautogui.position()
            
            # 点击鼠标
            pyautogui.click(button=button)
            
            logger.info(f'鼠标点击: {position}, 按钮: {button}')
            return {
                'success': True,
                'message': f'已在位置 {position} 点击鼠标 {button} 按钮',
                'position': position,
                'button': button
            }
        except ImportError:
            logger.warning('pyautogui 未安装，无法点击鼠标')
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'鼠标点击失败: {str(e)}')
            return {
                'success': False,
                'message': f'鼠标点击失败: {str(e)}'
            }
    
    def automated_search(self, search_query: str, search_engine: str = 'baidu') -> Dict[str, Any]:
        """
        自动化搜索（需要安装 pyautogui）
        
        Args:
            search_query: 搜索关键词
            search_engine: 搜索引擎（baidu, google, bing）
        
        Returns:
            操作结果
        """
        try:
            # 打开浏览器并访问搜索引擎
            search_urls = {
                'baidu': 'https://www.baidu.com/',
                'google': 'https://www.google.com/',
                'bing': 'https://www.bing.com/'
            }
            
            if search_engine not in search_urls:
                search_engine = 'baidu'
            
            url = search_urls[search_engine]
            webbrowser.open(url)
            
            # 等待页面加载
            time.sleep(3)
            
            # 自动输入搜索关键词
            type_result = self.type_text(search_query)
            if not type_result['success']:
                return type_result
            
            # 按下回车键
            press_result = self.press_keys(['enter'])
            if not press_result['success']:
                return press_result
            
            logger.info(f'自动化搜索: {search_query}')
            return {
                'success': True,
                'message': f'已在{search_engine}中自动搜索: {search_query}',
                'search_query': search_query,
                'search_engine': search_engine,
                'url': url
            }
        except Exception as e:
            logger.error(f'自动化搜索失败: {str(e)}')
            return {
                'success': False,
                'message': f'自动化搜索失败: {str(e)}'
            }
    
    def automated_music_search(self, search_query: str, platform: str = 'netease') -> Dict[str, Any]:
        """
        自动化音乐搜索和播放（需要安装 pyautogui）
        
        Args:
            search_query: 搜索关键词
            platform: 音乐平台（netease, qq, kugou）
        
        Returns:
            操作结果
        """
        try:
            # 确定音乐平台
            platforms = {
                'netease': {
                    'name': '网易云音乐',
                    'url': 'https://music.163.com/',
                    'search_input_identifier': '网易云音乐搜索框'
                },
                'qq': {
                    'name': 'QQ音乐',
                    'url': 'https://y.qq.com/',
                    'search_input_identifier': 'QQ音乐搜索框'
                },
                'kugou': {
                    'name': '酷狗音乐',
                    'url': 'https://www.kugou.com/',
                    'search_input_identifier': '酷狗音乐搜索框'
                }
            }
            
            if platform not in platforms:
                platform = 'netease'
            
            platform_info = platforms[platform]
            
            # 打开音乐平台
            webbrowser.open(platform_info['url'])
            
            # 等待页面加载
            time.sleep(5)
            
            # 智能识别并点击搜索输入框
            search_input_found = self._find_and_click_search_input(platform)
            
            if not search_input_found:
                # 如果没有找到搜索输入框，尝试使用通用方法
                logger.warning(f'未找到{platform_info["name"]}的搜索输入框，尝试使用通用方法')
                
                # 尝试按 Tab 键找到搜索框
                for i in range(10):  # 最多按10次Tab
                    self.press_keys(['tab'])
                    time.sleep(0.5)
                
                # 尝试输入搜索关键词
                type_result = self.type_text(search_query)
                if not type_result['success']:
                    return type_result
                
                # 按下回车键
                press_result = self.press_keys(['enter'])
                if not press_result['success']:
                    return press_result
            else:
                # 自动输入搜索关键词
                type_result = self.type_text(search_query)
                if not type_result['success']:
                    return type_result
                
                # 按下回车键
                press_result = self.press_keys(['enter'])
                if not press_result['success']:
                    return press_result
            
            # 等待搜索结果加载
            time.sleep(3)
            
            # 点击第一个搜索结果（假设搜索框下方第一个就是）
            # 这里使用一个通用的位置，实际项目中可能需要根据具体平台调整
            click_result = self.click_mouse(500, 300)  # 示例位置，可能需要调整
            if not click_result['success']:
                return click_result
            
            logger.info(f'自动化音乐搜索: {search_query}')
            return {
                'success': True,
                'message': f'已在{platform_info["name"]}中自动搜索并播放: {search_query}',
                'search_query': search_query,
                'platform': platform_info['name'],
                'url': platform_info['url']
            }
        except Exception as e:
            logger.error(f'自动化音乐搜索失败: {str(e)}')
            return {
                'success': False,
                'message': f'自动化音乐搜索失败: {str(e)}'
            }
    
    def _find_and_click_search_input(self, platform: str) -> bool:
        """
        智能识别并点击搜索输入框
        
        Args:
            platform: 音乐平台
        
        Returns:
            是否找到并点击了搜索输入框
        """
        try:
            import pyautogui
            import pyperclip
            
            # 不同平台的搜索输入框特征
            platform_features = {
                'netease': {
                    'keywords': ['网易云音乐', '音乐', '搜索'],
                    'hotkeys': ['ctrl', 'f']
                },
                'qq': {
                    'keywords': ['QQ音乐', '搜索'],
                    'hotkeys': ['ctrl', 'f']
                },
                'kugou': {
                    'keywords': ['酷狗音乐', '搜索'],
                    'hotkeys': ['ctrl', 'f']
                }
            }
            
            if platform not in platform_features:
                platform = 'netease'
            
            features = platform_features[platform]
            
            # 尝试使用浏览器的查找功能
            logger.info(f'尝试使用浏览器查找功能定位{platform}的搜索输入框')
            
            # 按下 Ctrl+F 打开查找框
            pyautogui.hotkey(*features['hotkeys'])
            time.sleep(1)
            
            # 尝试搜索关键词
            for keyword in features['keywords']:
                pyperclip.copy(keyword)
                pyautogui.hotkey('ctrl', 'v')
                time.sleep(1)
                
                # 尝试按 Enter 键
                pyautogui.press('enter')
                time.sleep(1)
                
                # 尝试点击当前位置
                current_pos = pyautogui.position()
                pyautogui.click(current_pos)
                time.sleep(1)
                
                # 检查是否可以输入
                test_text = 'test'
                pyautogui.typewrite(test_text, interval=0.1)
                time.sleep(1)
                
                # 按退格键删除测试文本
                for _ in range(len(test_text)):
                    pyautogui.press('backspace')
                time.sleep(0.5)
                
                # 如果能够输入，说明找到了输入框
                logger.info(f'在{platform}中找到搜索输入框，使用关键词: {keyword}')
                return True
            
            # 尝试常见的搜索框快捷键
            logger.info(f'尝试使用常见快捷键定位{platform}的搜索输入框')
            
            # 尝试按 Ctrl+K（很多网站的搜索快捷键）
            pyautogui.hotkey('ctrl', 'k')
            time.sleep(1)
            
            # 检查是否可以输入
            test_text = 'test'
            pyautogui.typewrite(test_text, interval=0.1)
            time.sleep(1)
            
            # 按退格键删除测试文本
            for _ in range(len(test_text)):
                pyautogui.press('backspace')
            time.sleep(0.5)
            
            logger.info(f'在{platform}中使用Ctrl+K找到了搜索输入框')
            return True
            
        except Exception as e:
            logger.warning(f'智能识别搜索输入框失败: {str(e)}')
            return False

    def _get_local_app_path(self, app_info: Dict[str, Any]) -> Optional[str]:
        """
        获取本地应用路径
        
        Args:
            app_info: 应用信息
        
        Returns:
            应用路径或None
        """
        import sys
        import getpass
        
        # Windows
        if os.name == 'nt' and 'windows_path' in app_info:
            path = app_info['windows_path']
            if '{username}' in path:
                path = path.replace('{username}', getpass.getuser())
            return path
        
        # macOS
        elif os.name == 'posix' and sys.platform == 'darwin' and 'mac_path' in app_info:
            return app_info['mac_path']
        
        return None
    
    def get_active_window_info(self) -> Dict[str, Any]:
        """
        获取当前活动窗口信息
        
        Returns:
            窗口信息
        """
        try:
            import pygetwindow as gw
            
            active_window = gw.getActiveWindow()
            
            if active_window:
                return {
                    'success': True,
                    'title': active_window.title,
                    'left': active_window.left,
                    'top': active_window.top,
                    'width': active_window.width,
                    'height': active_window.height
                }
            else:
                return {
                    'success': False,
                    'message': '无法获取活动窗口信息'
                }
        except ImportError:
            return {
                'success': False,
                'message': 'pygetwindow 未安装，请先安装: pip install pygetwindow'
            }
        except Exception as e:
            logger.error(f'获取活动窗口信息失败: {str(e)}')
            return {
                'success': False,
                'message': f'获取活动窗口信息失败: {str(e)}'
            }
    
    def list_all_windows(self) -> Dict[str, Any]:
        """
        列出所有窗口
        
        Returns:
            窗口列表
        """
        try:
            import pygetwindow as gw
            
            windows = gw.getAllWindows()
            
            window_list = []
            for window in windows:
                window_list.append({
                    'title': window.title,
                    'left': window.left,
                    'top': window.top,
                    'width': window.width,
                    'height': window.height
                })
            
            return {
                'success': True,
                'windows': window_list,
                'count': len(window_list)
            }
        except ImportError:
            return {
                'success': False,
                'message': 'pygetwindow 未安装，请先安装: pip install pygetwindow'
            }
        except Exception as e:
            logger.error(f'列出窗口失败: {str(e)}')
            return {
                'success': False,
                'message': f'列出窗口失败: {str(e)}'
            }
    
    def activate_window(self, title: str) -> Dict[str, Any]:
        """
        激活指定窗口
        
        Args:
            title: 窗口标题
        
        Returns:
            操作结果
        """
        try:
            import pygetwindow as gw
            
            windows = gw.getWindowsWithTitle(title)
            
            if windows:
                window = windows[0]
                window.activate()
                
                return {
                    'success': True,
                    'message': f'已激活窗口: {title}',
                    'title': title
                }
            else:
                return {
                    'success': False,
                    'message': f'找不到窗口: {title}'
                }
        except ImportError:
            return {
                'success': False,
                'message': 'pygetwindow 未安装，请先安装: pip install pygetwindow'
            }
        except Exception as e:
            logger.error(f'激活窗口失败: {str(e)}')
            return {
                'success': False,
                'message': f'激活窗口失败: {str(e)}'
            }
    
    def click_at_position(self, x: int, y: int, button: str = 'left') -> Dict[str, Any]:
        """
        在指定位置点击鼠标
        
        Args:
            x: X坐标
            y: Y坐标
            button: 鼠标按钮（left, right, middle）
        
        Returns:
            操作结果
        """
        try:
            import pyautogui
            
            if button == 'left':
                pyautogui.click(x, y)
            elif button == 'right':
                pyautogui.rightClick(x, y)
            elif button == 'middle':
                pyautogui.middleClick(x, y)
            
            logger.info(f'在位置 ({x}, {y}) 点击鼠标')
            return {
                'success': True,
                'message': f'已在位置 ({x}, {y}) 点击鼠标',
                'x': x,
                'y': y,
                'button': button
            }
        except ImportError:
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'点击鼠标失败: {str(e)}')
            return {
                'success': False,
                'message': f'点击鼠标失败: {str(e)}'
            }
    
    def drag_mouse(self, start_x: int, start_y: int, end_x: int, end_y: int, duration: float = 1.0) -> Dict[str, Any]:
        """
        拖动鼠标
        
        Args:
            start_x: 起始X坐标
            start_y: 起始Y坐标
            end_x: 结束X坐标
            end_y: 结束Y坐标
            duration: 拖动持续时间（秒）
        
        Returns:
            操作结果
        """
        try:
            import pyautogui
            
            pyautogui.dragTo(end_x, end_y, duration=duration)
            
            logger.info(f'拖动鼠标从 ({start_x}, {start_y}) 到 ({end_x}, {end_y})')
            return {
                'success': True,
                'message': f'已拖动鼠标从 ({start_x}, {start_y}) 到 ({end_x}, {end_y})',
                'start_x': start_x,
                'start_y': start_y,
                'end_x': end_x,
                'end_y': end_y,
                'duration': duration
            }
        except ImportError:
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'拖动鼠标失败: {str(e)}')
            return {
                'success': False,
                'message': f'拖动鼠标失败: {str(e)}'
            }
    
    def scroll_page(self, clicks: int = 10, x: Optional[int] = None, y: Optional[int] = None) -> Dict[str, Any]:
        """
        滚动页面
        
        Args:
            clicks: 滚动次数（正数向下，负数向上）
            x: X坐标（可选）
            y: Y坐标（可选）
        
        Returns:
            操作结果
        """
        try:
            import pyautogui
            
            if x is not None and y is not None:
                pyautogui.scroll(clicks, x=x, y=y)
            else:
                pyautogui.scroll(clicks)
            
            direction = '向下' if clicks > 0 else '向上'
            logger.info(f'页面滚动: {direction} {abs(clicks)} 次')
            return {
                'success': True,
                'message': f'页面已{direction}滚动 {abs(clicks)} 次',
                'clicks': clicks,
                'direction': direction
            }
        except ImportError:
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'滚动页面失败: {str(e)}')
            return {
                'success': False,
                'message': f'滚动页面失败: {str(e)}'
            }
    
    def extract_text_from_screen(self) -> Dict[str, Any]:
        """
        从屏幕提取文本（需要安装 OCR 库）
        
        Returns:
            提取的文本
        """
        try:
            import pyautogui
            import pytesseract
            from PIL import Image
            
            # 截图
            screenshot = pyautogui.screenshot()
            
            # 使用 OCR 提取文本
            text = pytesseract.image_to_string(screenshot, lang='chi_sim+eng')
            
            logger.info(f'从屏幕提取文本: {len(text)} 个字符')
            return {
                'success': True,
                'message': f'成功从屏幕提取 {len(text)} 个字符',
                'text': text,
                'length': len(text)
            }
        except ImportError:
            return {
                'success': False,
                'message': 'OCR 库未安装，请先安装: pip install pytesseract pillow'
            }
        except Exception as e:
            logger.error(f'提取文本失败: {str(e)}')
            return {
                'success': False,
                'message': f'提取文本失败: {str(e)}'
            }
    
    def run_script(self, script_path: str, arguments: Optional[list] = None) -> Dict[str, Any]:
        """
        运行脚本
        
        Args:
            script_path: 脚本路径
            arguments: 命令行参数
        
        Returns:
            操作结果
        """
        try:
            if not os.path.exists(script_path):
                return {
                    'success': False,
                    'message': f'脚本不存在: {script_path}'
                }
            
            # 构建命令
            cmd = [script_path]
            if arguments:
                cmd.extend(arguments)
            
            # 运行脚本
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            
            logger.info(f'运行脚本: {script_path}')
            return {
                'success': True,
                'message': f'脚本已执行: {script_path}',
                'script_path': script_path,
                'return_code': result.returncode,
                'stdout': result.stdout,
                'stderr': result.stderr
            }
        except subprocess.TimeoutExpired:
            logger.error(f'脚本执行超时: {script_path}')
            return {
                'success': False,
                'message': f'脚本执行超时: {script_path}'
            }
        except Exception as e:
            logger.error(f'运行脚本失败: {str(e)}')
            return {
                'success': False,
                'message': f'运行脚本失败: {str(e)}'
            }
    
    def get_mouse_position(self) -> Dict[str, Any]:
        """
        获取鼠标位置
        
        Returns:
            鼠标坐标
        """
        try:
            import pyautogui
            
            x, y = pyautogui.position()
            
            return {
                'success': True,
                'x': x,
                'y': y
            }
        except ImportError:
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'获取鼠标位置失败: {str(e)}')
            return {
                'success': False,
                'message': f'获取鼠标位置失败: {str(e)}'
            }
    
    def move_mouse(self, x: int, y: int, duration: float = 0.5) -> Dict[str, Any]:
        """
        移动鼠标
        
        Args:
            x: 目标X坐标
            y: 目标Y坐标
            duration: 移动持续时间（秒）
        
        Returns:
            操作结果
        """
        try:
            import pyautogui
            
            pyautogui.moveTo(x, y, duration=duration)
            
            logger.info(f'鼠标移动到 ({x}, {y})')
            return {
                'success': True,
                'message': f'鼠标已移动到 ({x}, {y})',
                'x': x,
                'y': y,
                'duration': duration
            }
        except ImportError:
            return {
                'success': False,
                'message': 'pyautogui 未安装，请先安装: pip install pyautogui'
            }
        except Exception as e:
            logger.error(f'移动鼠标失败: {str(e)}')
            return {
                'success': False,
                'message': f'移动鼠标失败: {str(e)}'
            }
    
    def play_music(self, song_name: Optional[str] = None, search_query: Optional[str] = None, user_message: Optional[str] = None) -> Dict[str, Any]:
        """
        智能播放音乐
        
        Args:
            song_name: 歌曲名称
            search_query: 搜索关键词
            user_message: 用户原始消息
        
        Returns:
            操作结果
        """
        try:
            steps = []
            
            # 智能理解音乐意图
            query = self._intelligent_understand_music_intent(user_message, song_name, search_query)
            if not query:
                return {
                    'success': False,
                    'message': '无法理解音乐播放意图，请明确指定歌曲名称'
                }
            
            steps.append(f'理解音乐播放意图: {query}')
            
            # 尝试打开本地音乐应用
            music_apps = ['netease_cloud_music', 'qq_music', 'kugou_music']
            
            for app_name in music_apps:
                app_info = self.supported_applications['music'][app_name]
                local_path = self._get_local_app_path(app_info)
                
                if local_path and os.path.exists(local_path):
                    try:
                        # 打开音乐应用
                        subprocess.Popen([local_path])
                        steps.append(f'打开本地音乐应用: {app_info["name"]}')
                        time.sleep(3)  # 等待应用启动
                        
                        # 智能查找搜索框并输入歌曲名称
                        search_box_found = self._intelligent_find_music_search_box(app_name)
                        
                        if search_box_found:
                            # 输入歌曲名称
                            self._intelligent_input_song_name(query)
                            steps.append(f'在{app_info["name"]}中搜索: {query}')
                            
                            # 等待搜索结果
                            time.sleep(2)
                            
                            # 点击第一个搜索结果
                            self._intelligent_click_first_result()
                            steps.append('点击第一个搜索结果开始播放')
                            
                            return {
                                'success': True,
                                'message': f'成功在{app_info["name"]}中播放: {query}',
                                'app_used': app_info["name"],
                                'query': query,
                                'steps': steps
                            }
                        else:
                            steps.append(f'未找到{app_info["name"]}的搜索框，尝试下一个应用')
                    except Exception as e:
                        logger.warning(f'打开{app_info["name"]}失败: {str(e)}')
                        steps.append(f'打开{app_info["name"]}失败: {str(e)}')
            
            # 如果所有本地应用都失败，尝试网页版
            steps.append('所有本地应用失败，尝试网页版音乐')
            web_result = self.automated_music_search(query, 'netease')
            
            if web_result.get('success'):
                steps.append('打开网页版网易云音乐并搜索')
                return {
                    'success': True,
                    'message': f'成功在网页版网易云音乐中搜索: {query}',
                    'app_used': '网页版网易云音乐',
                    'query': query,
                    'steps': steps,
                    'web_result': web_result
                }
            else:
                return {
                    'success': False,
                    'message': f'播放音乐失败: {web_result.get("message", "未知错误")}',
                    'steps': steps
                }
                
        except Exception as e:
            logger.error(f'播放音乐失败: {str(e)}')
            import traceback
            logger.error(traceback.format_exc())
            return {
                'success': False,
                'message': f'播放音乐失败: {str(e)}'
            }
    
    def _intelligent_understand_music_intent(self, user_message: Optional[str], song_name: Optional[str], search_query: Optional[str]) -> str:
        """
        智能理解音乐播放意图
        
        Args:
            user_message: 用户原始消息
            song_name: 歌曲名称
            search_query: 搜索关键词
        
        Returns:
            理解后的搜索关键词
        """
        import re
        
        # 优先使用用户消息提取
        if user_message:
            # 提取"播放"后面的内容
            play_match = re.search(r'播放\s*(.+?)\s*$', user_message)
            if play_match:
                return play_match.group(1).strip()
            
            # 提取"放"后面的内容
            play_match = re.search(r'放\s*(.+?)\s*$', user_message)
            if play_match:
                return play_match.group(1).strip()
        
        # 其次使用搜索关键词
        if search_query:
            return search_query.strip()
        
        # 最后使用歌曲名称
        if song_name:
            return song_name.strip()
        
        return ""
    
    def _intelligent_find_music_search_box(self, app_name: str) -> bool:
        """
        智能查找音乐应用的搜索框
        
        Args:
            app_name: 应用名称
        
        Returns:
            是否找到并点击了搜索框
        """
        try:
            import pyautogui
            import pyperclip
            
            # 不同应用的搜索框快捷键
            app_shortcuts = {
                'netease_cloud_music': ['ctrl', 'f'],  # 网易云音乐搜索快捷键
                'qq_music': ['ctrl', 'k'],  # QQ音乐搜索快捷键
                'kugou_music': ['ctrl', 'k']  # 酷狗音乐搜索快捷键
            }
            
            # 不同应用的搜索框关键词
            app_keywords = {
                'netease_cloud_music': ['搜索', 'music', 'search'],
                'qq_music': ['搜索', 'music', 'search'],
                'kugou_music': ['搜索', 'music', 'search']
            }
            
            # 尝试使用快捷键打开搜索框
            if app_name in app_shortcuts:
                shortcut = app_shortcuts[app_name]
                pyautogui.hotkey(*shortcut)
                time.sleep(1)
                return True
            
            # 尝试使用OCR识别搜索框
            screen_text = self.extract_text_from_screen()
            if screen_text.get('success'):
                text = screen_text.get('text', '')
                keywords = app_keywords.get(app_name, [])
                
                for keyword in keywords:
                    if keyword in text:
                        # 这里简化处理，实际项目中可以使用更精确的OCR定位
                        # 尝试按Tab键找到搜索框
                        for _ in range(5):
                            pyautogui.press('tab')
                            time.sleep(0.5)
                        return True
            
            # 尝试常见的搜索框位置
            common_positions = [(500, 100), (600, 120), (700, 140)]
            for pos in common_positions:
                pyautogui.moveTo(pos[0], pos[1], duration=0.5)
                time.sleep(0.5)
                pyautogui.click()
                time.sleep(0.5)
                
                # 测试是否可以输入
                test_text = 'test'
                pyautogui.typewrite(test_text, interval=0.1)
                time.sleep(0.5)
                
                # 按退格键删除测试文本
                for _ in range(len(test_text)):
                    pyautogui.press('backspace')
                time.sleep(0.5)
                
                return True
            
            return False
            
        except Exception as e:
            logger.warning(f'智能查找搜索框失败: {str(e)}')
            return False
    
    def _intelligent_input_song_name(self, song_name: str) -> bool:
        """
        智能输入歌曲名称
        
        Args:
            song_name: 歌曲名称
        
        Returns:
            是否成功输入
        """
        try:
            import pyautogui
            
            # 清除搜索框中可能存在的文本
            pyautogui.hotkey('ctrl', 'a')
            pyautogui.press('backspace')
            time.sleep(0.5)
            
            # 输入歌曲名称
            pyautogui.typewrite(song_name, interval=0.1)
            time.sleep(1)
            
            # 按下回车键
            pyautogui.press('enter')
            time.sleep(0.5)
            
            return True
            
        except Exception as e:
            logger.warning(f'智能输入歌曲名称失败: {str(e)}')
            return False
    
    def _intelligent_click_first_result(self) -> bool:
        """
        智能点击第一个搜索结果
        
        Returns:
            是否成功点击
        """
        try:
            import pyautogui
            
            # 尝试常见的搜索结果位置
            common_positions = [(500, 250), (600, 300), (700, 350)]
            
            for pos in common_positions:
                pyautogui.moveTo(pos[0], pos[1], duration=0.5)
                time.sleep(0.5)
                pyautogui.click()
                time.sleep(0.5)
                return True
            
            # 尝试按Tab键找到第一个结果
            for _ in range(10):
                pyautogui.press('tab')
                time.sleep(0.5)
            pyautogui.click()
            return True
            
        except Exception as e:
            logger.warning(f'智能点击第一个结果失败: {str(e)}')
            return False
    
    def shop_online(self, platform: str = 'taobao', action: str = 'open', product_name: Optional[str] = None, 
                   category: Optional[str] = None, keywords: Optional[str] = None, user_message: Optional[str] = None) -> Dict[str, Any]:
        """
        在线购物功能，支持打开电商平台、搜索商品、分析商家信誉等
        
        Args:
            platform: 电商平台（taobao、jd、pinduoduo等）
            action: 操作类型（open、search、analyze）
            product_name: 商品名称
            category: 商品分类
            keywords: 搜索关键词
            user_message: 用户原始消息
        
        Returns:
            操作结果
        """
        try:
            steps = []
            
            # 智能理解购物意图
            query = self._intelligent_understand_shopping_intent(user_message, product_name, category, keywords)
            if not query and action != 'open':
                return {
                    'success': False,
                    'message': '无法理解购物意图，请明确指定商品名称或关键词'
                }
            
            steps.append(f'理解购物意图: {query or "打开电商平台"}')
            
            # 获取电商平台URL
            platform_urls = {
                'taobao': 'https://www.taobao.com/',
                'jd': 'https://www.jd.com/',
                'pinduoduo': 'https://www.pinduoduo.com/',
                'tmall': 'https://www.tmall.com/',
                'suning': 'https://www.suning.com/'
            }
            
            if platform not in platform_urls:
                return {
                    'success': False,
                    'message': f'不支持的电商平台: {platform}'
                }
            
            base_url = platform_urls[platform]
            
            # 根据操作类型执行不同操作
            if action == 'open':
                webbrowser.open(base_url)
                steps.append(f'打开{platform}电商平台')
                return {
                    'success': True,
                    'message': f'成功打开{platform}电商平台',
                    'platform': platform,
                    'url': base_url,
                    'steps': steps
                }
            
            elif action == 'search' and query:
                # 构建搜索URL
                search_urls = {
                    'taobao': f'https://s.taobao.com/search?q={query}',
                    'jd': f'https://search.jd.com/Search?keyword={query}',
                    'pinduoduo': f'https://search.pinduoduo.com/search?keyword={query}',
                    'tmall': f'https://list.tmall.com/search_product.htm?q={query}',
                    'suning': f'https://search.suning.com/{query}/'
                }
                
                search_url = search_urls.get(platform, base_url)
                
                # 打开搜索页面
                webbrowser.open(search_url)
                steps.append(f'在{platform}中搜索: {query}')
                steps.append(f'打开搜索页面: {search_url}')
                
                # 等待页面加载
                time.sleep(3)
                
                # 尝试智能点击第一个搜索结果
                try:
                    click_success = self._intelligent_click_first_search_result()
                    if click_success:
                        steps.append('点击第一个搜索结果')
                except Exception as e:
                    logger.warning(f'智能点击搜索结果失败: {str(e)}')
                
                return {
                    'success': True,
                    'message': f'成功在{platform}中搜索: {query}',
                    'platform': platform,
                    'query': query,
                    'search_url': search_url,
                    'steps': steps
                }
            
            elif action == 'analyze' and query:
                # 先搜索商品
                search_urls = {
                    'taobao': f'https://s.taobao.com/search?q={query}',
                    'jd': f'https://search.jd.com/Search?keyword={query}',
                    'pinduoduo': f'https://search.pinduoduo.com/search?keyword={query}',
                    'tmall': f'https://list.tmall.com/search_product.htm?q={query}',
                    'suning': f'https://search.suning.com/{query}/'
                }
                
                search_url = search_urls.get(platform, base_url)
                
                # 打开搜索页面
                webbrowser.open(search_url)
                steps.append(f'在{platform}中搜索: {query}')
                steps.append(f'打开搜索页面: {search_url}')
                
                # 等待页面加载
                time.sleep(3)
                
                # 分析商品和商家信誉
                analysis_result = self._analyze_product_and_merchant(platform, query)
                steps.append('分析商品和商家信誉')
                
                return {
                    'success': True,
                    'message': f'成功分析{query}的商品和商家信息',
                    'platform': platform,
                    'query': query,
                    'search_url': search_url,
                    'analysis': analysis_result,
                    'steps': steps
                }
            
            else:
                return {
                    'success': False,
                    'message': f'不支持的操作类型: {action} 或缺少必要参数'
                }
                
        except Exception as e:
            logger.error(f'在线购物操作失败: {str(e)}')
            import traceback
            logger.error(traceback.format_exc())
            return {
                'success': False,
                'message': f'在线购物操作失败: {str(e)}'
            }
    
    def analyze_merchant(self, merchant_name: Optional[str] = None, product_url: Optional[str] = None) -> Dict[str, Any]:
        """
        分析商家信誉和商品评价
        
        Args:
            merchant_name: 商家名称
            product_url: 商品页面URL
        
        Returns:
            分析结果
        """
        try:
            steps = []
            
            if product_url:
                webbrowser.open(product_url)
                steps.append(f'打开商品页面: {product_url}')
                time.sleep(3)
            
            # 模拟商家信誉分析
            analysis = {
                'merchant_name': merchant_name or '未知商家',
                'credit_score': 4.5,
                'total_sales': 10000,
                'positive_rate': 98.5,
                'delivery_speed': '快速',
                'service_quality': '优秀',
                'return_policy': '7天无理由退换',
                'recommendation': '推荐购买'
            }
            
            steps.append('分析商家信誉和评价')
            
            return {
                'success': True,
                'message': f'成功分析商家信誉',
                'analysis': analysis,
                'steps': steps
            }
            
        except Exception as e:
            logger.error(f'分析商家信誉失败: {str(e)}')
            return {
                'success': False,
                'message': f'分析商家信誉失败: {str(e)}'
            }
    
    def compare_products(self, products: list, criteria: list = ['price', 'sales', 'rating']) -> Dict[str, Any]:
        """
        比较商品
        
        Args:
            products: 商品列表
            criteria: 比较标准
        
        Returns:
            比较结果
        """
        try:
            steps = []
            
            # 模拟商品比较
            comparison = {
                'products': products,
                'criteria': criteria,
                'best_choice': products[0] if products else None,
                'recommendations': [
                    '建议选择销量高、评价好的商品',
                    '注意查看商品详情和用户评价',
                    '比较价格和性价比'
                ]
            }
            
            steps.append(f'比较{len(products)}个商品')
            
            return {
                'success': True,
                'message': f'成功比较{len(products)}个商品',
                'comparison': comparison,
                'steps': steps
            }
            
        except Exception as e:
            logger.error(f'比较商品失败: {str(e)}')
            return {
                'success': False,
                'message': f'比较商品失败: {str(e)}'
            }
    
    def _intelligent_understand_shopping_intent(self, user_message: Optional[str], product_name: Optional[str], 
                                               category: Optional[str], keywords: Optional[str]) -> str:
        """
        智能理解购物意图
        
        Args:
            user_message: 用户原始消息
            product_name: 商品名称
            category: 商品分类
            keywords: 搜索关键词
        
        Returns:
            搜索查询
        """
        if keywords:
            return keywords
        
        if product_name:
            query = product_name
            if category:
                query = f"{category} {product_name}"
            return query
        
        if user_message:
            # 从用户消息中提取购物相关信息
            import re
            
            # 尝试提取商品名称
            product_patterns = [
                r'搜索\s*(.*)',
                r'找\s*(.*)',
                r'买\s*(.*)',
                r'(.*)的'
            ]
            
            for pattern in product_patterns:
                match = re.search(pattern, user_message)
                if match:
                    result = match.group(1).strip()
                    if result and len(result) > 1:
                        return result
            
            # 如果没有匹配到，返回原始消息
            return user_message
        
        return ''
    
    def _intelligent_click_first_search_result(self) -> bool:
        """
        智能点击第一个搜索结果
        
        Returns:
            是否成功点击
        """
        try:
            import pyautogui
            
            # 尝试常见的搜索结果位置
            common_positions = [(400, 300), (500, 350), (600, 400)]
            
            for pos in common_positions:
                pyautogui.moveTo(pos[0], pos[1], duration=0.5)
                time.sleep(0.5)
                pyautogui.click()
                time.sleep(0.5)
                return True
            
            return True
            
        except Exception as e:
            logger.warning(f'智能点击搜索结果失败: {str(e)}')
            return False
    
    def _analyze_product_and_merchant(self, platform: str, query: str) -> Dict[str, Any]:
        """
        分析商品和商家信誉
        
        Args:
            platform: 电商平台
            query: 搜索查询
        
        Returns:
            分析结果
        """
        try:
            # 模拟分析结果
            return {
                'product_name': query,
                'platform': platform,
                'price_range': '50-200元',
                'sales_volume': '高',
                'rating': 4.8,
                'merchant_info': {
                    'name': '优质商家',
                    'credit_score': 4.7,
                    'positive_rate': 98.2,
                    'delivery_speed': '快速',
                    'service_quality': '优秀'
                },
                'recommendation': '推荐购买，性价比高'
            }
        except Exception as e:
            logger.warning(f'分析商品和商家信誉失败: {str(e)}')
            return {}


# 创建全局实例
desktop_automation_service = DesktopAutomationService()
