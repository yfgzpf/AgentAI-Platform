import asyncio
import subprocess
import os
import tempfile
import json
from typing import Dict, Any, Optional
from loguru import logger


class CodeExecutorService:
    """代码执行服务 - 支持Python代码执行和测试"""
    
    def __init__(self):
        self.supported_languages = {
            'python': {
                'extension': '.py',
                'command': ['python'],
                'description': 'Python代码执行'
            },
            'javascript': {
                'extension': '.js',
                'command': ['node'],
                'description': 'JavaScript代码执行'
            },
            'bash': {
                'extension': '.sh',
                'command': ['bash'],
                'description': 'Bash脚本执行'
            }
        }
        
        logger.info("代码执行服务初始化完成")
    
    async def execute_code(
        self,
        code: str,
        language: str = 'python',
        timeout: int = 30,
        working_dir: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        执行代码
        
        Args:
            code: 要执行的代码
            language: 编程语言 (python, javascript, bash)
            timeout: 超时时间（秒）
            working_dir: 工作目录
        
        Returns:
            执行结果
        """
        try:
            # 检查语言支持
            if language not in self.supported_languages:
                return {
                    'success': False,
                    'error': f'不支持的语言: {language}',
                    'supported_languages': list(self.supported_languages.keys())
                }
            
            lang_config = self.supported_languages[language]
            
            # 创建临时文件
            with tempfile.NamedTemporaryFile(
                mode='w',
                suffix=lang_config['extension'],
                delete=False,
                encoding='utf-8'
            ) as f:
                f.write(code)
                temp_file = f.name
            
            try:
                # 执行代码
                command = lang_config['command'] + [temp_file]
                
                logger.info(f"执行{language}代码: {temp_file}")
                logger.info(f"执行命令: {' '.join(command)}")
                
                # 使用subprocess.run执行代码
                import subprocess
                try:
                    result = subprocess.run(
                        command,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        cwd=working_dir
                    )
                    
                    stdout = result.stdout
                    stderr = result.stderr
                    return_code = result.returncode
                except subprocess.TimeoutExpired:
                    return {
                        'success': False,
                        'error': f'代码执行超时（{timeout}秒）',
                        'timeout': True
                    }
                except Exception as e:
                    logger.error(f"subprocess执行失败: {str(e)}")
                    raise
                
                # 解析输出
                result_data = {
                    'success': return_code == 0,
                    'language': language,
                    'return_code': return_code,
                    'stdout': stdout.strip() if stdout else '',
                    'stderr': stderr.strip() if stderr else '',
                    'execution_time': timeout
                }
                
                # 如果有错误输出，添加到结果中
                if stderr and return_code != 0:
                    result_data['error'] = stderr
                    result_data['error_type'] = 'runtime_error'
                elif return_code != 0:
                    result_data['error'] = f'进程退出码: {return_code}'
                    result_data['error_type'] = 'exit_code_error'
                
                logger.info(f"代码执行完成: 返回码={return_code}, 成功={result_data['success']}")
                
                return result_data
                
            finally:
                # 清理临时文件
                try:
                    if os.path.exists(temp_file):
                        os.unlink(temp_file)
                except Exception as e:
                    logger.warning(f"清理临时文件失败: {str(e)}")
                    
        except Exception as e:
            logger.error(f"代码执行失败: {str(e)}")
            logger.error(f"异常类型: {type(e).__name__}")
            logger.error(f"异常详情: {repr(e)}")
            return {
                'success': False,
                'error': str(e),
                'error_type': 'execution_error'
            }
    
    async def execute_python_code(
        self,
        code: str,
        timeout: int = 30,
        capture_output: bool = True
    ) -> Dict[str, Any]:
        """
        执行Python代码（专用方法）
        
        Args:
            code: Python代码
            timeout: 超时时间（秒）
            capture_output: 是否捕获输出
        
        Returns:
            执行结果
        """
        try:
            # 创建临时Python文件
            with tempfile.NamedTemporaryFile(
                mode='w',
                suffix='.py',
                delete=False,
                encoding='utf-8'
            ) as f:
                f.write(code)
                temp_file = f.name
            
            try:
                # 执行Python代码
                command = ['python', temp_file]
                
                logger.info(f"执行Python代码: {len(code)}字符")
                
                # 使用subprocess.run执行代码
                import subprocess
                if capture_output:
                    try:
                        result = subprocess.run(
                            command,
                            capture_output=True,
                            text=True,
                            timeout=timeout
                        )
                        
                        stdout = result.stdout
                        stderr = result.stderr
                        return_code = result.returncode
                    except subprocess.TimeoutExpired:
                        return {
                            'success': False,
                            'error': f'Python代码执行超时（{timeout}秒）',
                            'timeout': True
                        }
                    
                    result_data = {
                        'success': return_code == 0,
                        'language': 'python',
                        'return_code': return_code,
                        'stdout': stdout.strip() if stdout else '',
                        'stderr': stderr.strip() if stderr else '',
                        'execution_time': timeout
                    }
                    
                    if stderr and return_code != 0:
                        result_data['error'] = stderr
                        result_data['error_type'] = 'runtime_error'
                    
                    return result_data
                else:
                    # 不捕获输出，直接执行
                    try:
                        result = subprocess.run(
                            command,
                            timeout=timeout
                        )
                        return_code = result.returncode
                    except subprocess.TimeoutExpired:
                        return {
                            'success': False,
                            'error': f'Python代码执行超时（{timeout}秒）',
                            'timeout': True
                        }
                    
                    return {
                        'success': return_code == 0,
                        'language': 'python',
                        'return_code': return_code,
                        'execution_time': timeout
                    }
                    
            finally:
                # 清理临时文件
                try:
                    if os.path.exists(temp_file):
                        os.unlink(temp_file)
                except Exception as e:
                    logger.warning(f"清理临时文件失败: {str(e)}")
                    
        except Exception as e:
            logger.error(f"Python代码执行失败: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'error_type': 'execution_error'
            }
    
    async def test_code(
        self,
        code: str,
        test_cases: list,
        language: str = 'python'
    ) -> Dict[str, Any]:
        """
        测试代码
        
        Args:
            code: 要测试的代码
            test_cases: 测试用例列表
            language: 编程语言
        
        Returns:
            测试结果
        """
        try:
            results = []
            passed_count = 0
            failed_count = 0
            
            for i, test_case in enumerate(test_cases):
                logger.info(f"运行测试用例 {i+1}/{len(test_cases)}")
                
                # 执行代码并传入测试参数
                test_code = f"{code}\n\n# 测试用例 {i+1}\n{test_case.get('test_code', '')}"
                
                result = await self.execute_code(test_code, language, timeout=10)
                
                test_result = {
                    'test_case': i + 1,
                    'description': test_case.get('description', f'测试用例 {i+1}'),
                    'success': result['success'],
                    'stdout': result.get('stdout', ''),
                    'stderr': result.get('stderr', ''),
                    'error': result.get('error', '')
                }
                
                if result['success']:
                    passed_count += 1
                    test_result['status'] = 'passed'
                else:
                    failed_count += 1
                    test_result['status'] = 'failed'
                
                results.append(test_result)
            
            return {
                'success': True,
                'total_tests': len(test_cases),
                'passed': passed_count,
                'failed': failed_count,
                'pass_rate': f"{(passed_count / len(test_cases) * 100):.1f}%",
                'test_results': results
            }
            
        except Exception as e:
            logger.error(f"代码测试失败: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    async def format_code(
        self,
        code: str,
        language: str = 'python',
        style: str = 'pep8'
    ) -> Dict[str, Any]:
        """
        格式化代码
        
        Args:
            code: 要格式化的代码
            language: 编程语言
            style: 格式化风格
        
        Returns:
            格式化结果
        """
        try:
            # Python代码格式化
            if language == 'python':
                if style == 'pep8':
                    # 使用autopep8格式化
                    try:
                        process = await asyncio.create_subprocess_exec(
                            'autopep8',
                            input=code.encode('utf-8'),
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE
                        )
                        
                        stdout, stderr = await asyncio.wait_for(
                            process.communicate(),
                            timeout=5
                        )
                        
                        if process.returncode == 0:
                            return {
                                'success': True,
                                'formatted_code': stdout.decode('utf-8'),
                                'language': language,
                                'style': style
                            }
                        else:
                            return {
                                'success': False,
                                'error': 'autopep8未安装或格式化失败',
                                'original_code': code
                            }
                    except asyncio.TimeoutError:
                        return {
                            'success': False,
                            'error': '代码格式化超时',
                            'original_code': code
                        }
                    except FileNotFoundError:
                        return {
                            'success': False,
                            'error': 'autopep8未安装，请运行: pip install autopep8',
                            'original_code': code
                        }
            
            return {
                'success': False,
                'error': f'不支持的格式化配置: language={language}, style={style}',
                'original_code': code
            }
            
        except Exception as e:
            logger.error(f"代码格式化失败: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'original_code': code
            }
    
    def get_supported_languages(self) -> list:
        """获取支持的编程语言列表"""
        return list(self.supported_languages.keys())
    
    def get_language_info(self, language: str) -> Optional[Dict[str, Any]]:
        """获取语言信息"""
        return self.supported_languages.get(language)


# 全局代码执行服务实例
code_executor_service = CodeExecutorService()
