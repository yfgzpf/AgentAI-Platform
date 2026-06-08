#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增强版AI写作服务
专门优化WPS和Word集成，提供更稳定的文档编辑功能
"""

import os
import time
import logging
import asyncio
import win32com.client as win32
import pythoncom
from typing import Dict, Any, Optional, AsyncGenerator, List
from pathlib import Path

logger = logging.getLogger(__name__)


class EnhancedAIWriterService:
    """增强版AI写作服务"""
    
    def __init__(self):
        self.supported_apps = {
            'word': {
                'name': 'Microsoft Word',
                'prog_id': 'Word.Application',
                'file_extensions': ['.doc', '.docx'],
                'default_template': 'Normal'
            },
            'wps': {
                'name': 'WPS Office Writer',
                'prog_id': 'KWPS.Application',  # WPS的ProgID
                'file_extensions': ['.wps', '.doc', '.docx'],
                'default_template': 'Normal'
            },
            'excel': {
                'name': 'Microsoft Excel',
                'prog_id': 'Excel.Application',
                'file_extensions': ['.xls', '.xlsx'],
                'default_template': 'Workbook'
            }
        }
        
        self.active_apps = {}
        
    def open_application(self, app_type: str, file_path: Optional[str] = None, maximize_window: bool = True) -> Dict[str, Any]:
        """
        打开办公应用
        
        Args:
            app_type: 应用类型 (word, wps, excel)
            file_path: 文件路径，如果为None则创建新文档
            maximize_window: 是否最大化窗口
        
        Returns:
            打开结果
        """
        try:
            if app_type not in self.supported_apps:
                return {
                    'success': False,
                    'error': f'不支持的应用类型: {app_type}'
                }
            
            app_config = self.supported_apps[app_type]
            
            # 初始化COM
            pythoncom.CoInitialize()
            
            # 尝试打开应用
            try:
                app = win32.Dispatch(app_config['prog_id'])
                app.Visible = True
                
                # 最大化窗口
                if maximize_window:
                    try:
                        if app_type in ['word', 'wps']:
                            app.WindowState = 1  # wdWindowStateMaximize
                        elif app_type == 'excel':
                            app.WindowState = -4137  # xlMaximized
                        logger.info(f'已最大化 {app_config["name"]} 窗口')
                    except Exception as e:
                        logger.warning(f'窗口最大化失败: {str(e)}')
                
                logger.info(f'成功打开 {app_config["name"]}')
                
                # 根据应用类型创建或打开文档
                if app_type in ['word', 'wps']:
                    if file_path and os.path.exists(file_path):
                        doc = app.Documents.Open(file_path)
                        logger.info(f'打开文档: {file_path}')
                    else:
                        doc = app.Documents.Add()
                        logger.info('创建新文档')
                    
                    self.active_apps[app_type] = {
                        'app': app,
                        'doc': doc,
                        'type': app_type
                    }
                    
                elif app_type == 'excel':
                    if file_path and os.path.exists(file_path):
                        workbook = app.Workbooks.Open(file_path)
                        logger.info(f'打开Excel文件: {file_path}')
                    else:
                        workbook = app.Workbooks.Add()
                        logger.info('创建新Excel文件')
                    
                    self.active_apps[app_type] = {
                        'app': app,
                        'workbook': workbook,
                        'type': app_type
                    }
                
                return {
                    'success': True,
                    'message': f'成功打开 {app_config["name"]}',
                    'app_type': app_type,
                    'app_name': app_config['name'],
                    'maximize_window': maximize_window
                }
                
            except Exception as e:
                logger.error(f'打开应用失败: {str(e)}')
                
                # 尝试备选方案
                return self._fallback_open_application(app_type, file_path, maximize_window)
                
        except Exception as e:
            logger.error(f'应用初始化失败: {str(e)}')
            return {
                'success': False,
                'error': f'应用初始化失败: {str(e)}'
            }
    
    def _fallback_open_application(self, app_type: str, file_path: Optional[str] = None, maximize_window: bool = True) -> Dict[str, Any]:
        """备选方案打开应用"""
        try:
            # 使用系统命令打开应用
            if app_type == 'word':
                cmd = 'winword.exe'
            elif app_type == 'excel':
                cmd = 'excel.exe'
            elif app_type == 'wps':
                # WPS可能有不同的可执行文件名
                cmd = 'wps.exe'  # 尝试常见名称
            else:
                return {'success': False, 'error': '不支持的应用类型'}
            
            import subprocess
            
            if file_path and os.path.exists(file_path):
                subprocess.Popen([cmd, file_path])
                logger.info(f'使用系统命令打开文件: {file_path}')
            else:
                subprocess.Popen([cmd])
                logger.info(f'使用系统命令打开应用: {cmd}')
            
            time.sleep(2)  # 等待应用启动
            
            # 尝试使用pyautogui最大化窗口
            if maximize_window:
                try:
                    import pyautogui
                    # 按Alt+空格+X最大化窗口
                    pyautogui.hotkey('alt', 'space')
                    pyautogui.press('x')
                    logger.info('使用pyautogui最大化窗口')
                except Exception as e:
                    logger.warning(f'备选方案窗口最大化失败: {str(e)}')
            
            return {
                'success': True,
                'message': f'使用备选方案成功打开 {app_type}',
                'method': 'system_command',
                'maximize_window': maximize_window
            }
            
        except Exception as e:
            logger.error(f'备选方案也失败: {str(e)}')
            return {
                'success': False,
                'error': f'所有打开方法都失败: {str(e)}'
            }
    
    def write_content(self, app_type: str, content: str, position: str = 'end', 
                     auto_format: bool = True, typing_speed: float = 0.02, 
                     enable_typewriter: bool = False) -> Dict[str, Any]:
        """
        写入内容到文档
        
        Args:
            app_type: 应用类型
            content: 要写入的内容
            position: 写入位置 (start, end, replace)
            auto_format: 是否自动格式化
            typing_speed: 打字速度（秒/字符）
            enable_typewriter: 是否启用打字机声音效果
        
        Returns:
            写入结果
        """
        try:
            if app_type not in self.active_apps:
                return {
                    'success': False,
                    'error': f'应用 {app_type} 未打开'
                }
            
            app_data = self.active_apps[app_type]
            
            if app_type in ['word', 'wps']:
                return self._write_to_word(app_data, content, position, auto_format, 
                                         typing_speed, enable_typewriter)
            elif app_type == 'excel':
                return self._write_to_excel(app_data, content, position, auto_format, 
                                          typing_speed, enable_typewriter)
            else:
                return {
                    'success': False,
                    'error': f'不支持的应用类型: {app_type}'
                }
                
        except Exception as e:
            logger.error(f'写入内容失败: {str(e)}')
            return {
                'success': False,
                'error': f'写入内容失败: {str(e)}'
            }
    
    def _write_to_word(self, app_data: Dict, content: str, position: str, auto_format: bool, 
                      typing_speed: float = 0.02, enable_typewriter: bool = False) -> Dict[str, Any]:
        """写入内容到Word/WPS文档"""
        try:
            doc = app_data['doc']
            
            # 初始化打字机声音
            typewriter_sound = None
            if enable_typewriter:
                try:
                    import winsound
                    typewriter_sound = winsound
                    logger.info('已启用打字机声音效果')
                except Exception as e:
                    logger.warning(f'打字机声音初始化失败: {str(e)}')
            
            # 根据位置选择写入策略
            if position == 'start':
                # 在文档开头插入
                range_obj = doc.Range(0, 0)
            elif position == 'replace':
                # 替换整个文档内容
                doc.Content.Text = ''
                range_obj = doc.Range(0, 0)
            else:  # end (默认)
                # 在文档末尾插入
                range_obj = doc.Range()
            
            # 逐字写入，模拟打字效果
            total_chars = len(content)
            for i, char in enumerate(content):
                # 插入字符
                range_obj.InsertAfter(char)
                range_obj.Collapse(0)  # 折叠到末尾
                
                # 播放打字机声音
                if typewriter_sound:
                    try:
                        # 播放简单的系统声音
                        typewriter_sound.Beep(800, 50)  # 频率800Hz，持续50ms
                    except Exception as e:
                        pass  # 忽略声音播放错误
                
                # 控制打字速度
                time.sleep(typing_speed)
            
            # 自动格式化
            if auto_format:
                self._auto_format_word_document(doc)
            
            logger.info(f'成功写入内容到Word文档，长度: {len(content)}')
            
            return {
                'success': True,
                'message': '内容已成功写入文档',
                'content_length': len(content),
                'position': position,
                'typing_speed': typing_speed,
                'enable_typewriter': enable_typewriter
            }
            
        except Exception as e:
            logger.error(f'Word写入失败: {str(e)}')
            return {
                'success': False,
                'error': f'Word写入失败: {str(e)}'
            }
    
    def _write_to_excel(self, app_data: Dict, content: str, position: str, auto_format: bool, 
                       typing_speed: float = 0.02, enable_typewriter: bool = False) -> Dict[str, Any]:
        """写入内容到Excel文档"""
        try:
            workbook = app_data['workbook']
            worksheet = workbook.ActiveSheet
            
            # 初始化打字机声音
            typewriter_sound = None
            if enable_typewriter:
                try:
                    import winsound
                    typewriter_sound = winsound
                    logger.info('已启用打字机声音效果')
                except Exception as e:
                    logger.warning(f'打字机声音初始化失败: {str(e)}')
            
            # 确定写入位置
            if position == 'replace':
                cell = worksheet.Cells(1, 1)
            else:
                # 查找最后一个非空单元格
                last_cell = worksheet.Cells.SpecialCells(11)  # xlCellTypeLastCell
                next_row = last_cell.Row + 1
                cell = worksheet.Cells(next_row, 1)
            
            # 逐字写入，模拟打字效果
            current_content = ''
            for i, char in enumerate(content):
                current_content += char
                cell.Value = current_content
                
                # 播放打字机声音
                if typewriter_sound:
                    try:
                        # 播放简单的系统声音
                        typewriter_sound.Beep(800, 50)  # 频率800Hz，持续50ms
                    except Exception as e:
                        pass  # 忽略声音播放错误
                
                # 控制打字速度
                time.sleep(typing_speed)
            
            # 自动调整列宽
            if auto_format:
                worksheet.Columns.AutoFit()
            
            logger.info(f'成功写入内容到Excel文档，长度: {len(content)}')
            
            return {
                'success': True,
                'message': '内容已成功写入Excel',
                'content_length': len(content),
                'position': position,
                'typing_speed': typing_speed,
                'enable_typewriter': enable_typewriter
            }
            
        except Exception as e:
            logger.error(f'Excel写入失败: {str(e)}')
            return {
                'success': False,
                'error': f'Excel写入失败: {str(e)}'
            }
    
    def _auto_format_word_document(self, doc) -> None:
        """自动格式化Word文档"""
        try:
            # 设置字体
            doc.Content.Font.Name = "宋体"
            doc.Content.Font.Size = 12
            
            # 设置段落格式
            doc.Content.ParagraphFormat.Alignment = 0  # 左对齐
            doc.Content.ParagraphFormat.LineSpacingRule = 0  # 单倍行距
            
            logger.info('文档自动格式化完成')
            
        except Exception as e:
            logger.warning(f'文档格式化失败: {str(e)}')
    
    async def write_content_streaming(self, app_type: str, content_generator: AsyncGenerator, 
                                    position: str = 'end', auto_format: bool = True) -> AsyncGenerator:
        """
        流式写入内容到文档
        
        Args:
            app_type: 应用类型
            content_generator: 内容生成器
            position: 写入位置
            auto_format: 是否自动格式化
        
        Yields:
            写入进度信息
        """
        try:
            total_chunks = 0
            current_chunk = 0
            
            # 收集所有内容块
            content_chunks = []
            async for chunk in content_generator:
                content_chunks.append(chunk)
                total_chunks += 1
            
            # 流式写入
            accumulated_content = ""
            
            for i, chunk in enumerate(content_chunks):
                current_chunk += 1
                accumulated_content += chunk
                
                # 每10个块写入一次，或者到达最后一个块
                if current_chunk % 10 == 0 or current_chunk == total_chunks:
                    result = self.write_content(app_type, accumulated_content, position, auto_format)
                    
                    if result['success']:
                        progress = {
                            'chunk': current_chunk,
                            'total_chunks': total_chunks,
                            'progress': f'{current_chunk}/{total_chunks}',
                            'percentage': int((current_chunk / total_chunks) * 100),
                            'message': f'已写入 {current_chunk}/{total_chunks} 块内容'
                        }
                        yield progress
                        
                        # 重置累积内容
                        accumulated_content = ""
                    else:
                        yield {
                            'error': result.get('error', '写入失败'),
                            'chunk': current_chunk
                        }
                
                # 短暂延迟，模拟实时写入
                await asyncio.sleep(0.1)
            
            yield {
                'completed': True,
                'message': '内容写入完成',
                'total_chunks': total_chunks
            }
            
        except Exception as e:
            logger.error(f'流式写入失败: {str(e)}')
            yield {
                'error': f'流式写入失败: {str(e)}',
                'completed': False
            }
    
    def close_application(self, app_type: str) -> Dict[str, Any]:
        """关闭应用"""
        try:
            if app_type in self.active_apps:
                app_data = self.active_apps[app_type]
                
                # 保存文档
                if 'doc' in app_data:
                    app_data['doc'].Save()
                elif 'workbook' in app_data:
                    app_data['workbook'].Save()
                
                # 关闭应用
                app_data['app'].Quit()
                
                # 清理资源
                del self.active_apps[app_type]
                
                logger.info(f'成功关闭 {app_type} 应用')
                
                return {
                    'success': True,
                    'message': f'{app_type} 应用已关闭'
                }
            else:
                return {
                    'success': False,
                    'error': f'应用 {app_type} 未打开'
                }
                
        except Exception as e:
            logger.error(f'关闭应用失败: {str(e)}')
            return {
                'success': False,
                'error': f'关闭应用失败: {str(e)}'
            }
    
    def get_supported_applications(self) -> List[str]:
        """获取支持的应用程序列表"""
        return list(self.supported_apps.keys())
    
    def get_application_info(self, app_type: str) -> Dict[str, Any]:
        """获取应用程序信息"""
        if app_type in self.supported_apps:
            return self.supported_apps[app_type]
        else:
            return {'error': '不支持的应用程序类型'}


# 创建全局实例
enhanced_ai_writer = EnhancedAIWriterService()


def test_enhanced_ai_writer():
    """测试增强版AI写作服务"""
    writer = EnhancedAIWriterService()
    
    # 测试打开Word
    result = writer.open_application('word')
    print("打开Word结果:", result)
    
    if result['success']:
        # 测试写入内容
        content = "这是一个测试文档内容，用于验证AI写作服务的功能。"
        write_result = writer.write_content('word', content)
        print("写入内容结果:", write_result)
        
        # 关闭应用
        close_result = writer.close_application('word')
        print("关闭应用结果:", close_result)
    
    # 测试WPS
    result = writer.open_application('wps')
    print("打开WPS结果:", result)
    
    if result['success']:
        close_result = writer.close_application('wps')
        print("关闭WPS结果:", close_result)


if __name__ == "__main__":
    test_enhanced_ai_writer()