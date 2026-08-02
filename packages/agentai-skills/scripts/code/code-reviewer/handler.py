#!/usr/bin/env python3
"""
Code Reviewer Handler
静态代码审查 — 检查常见问题和安全隐患 (纯 Python 内置模块)
"""

import json
import sys
import re
import ast

def lint_python(code):
    """Python 静态检查"""
    issues = []

    # 1. AST 语法检查
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        issues.append({
            'severity': 'critical',
            'file': '-',
            'line': e.lineno or 1,
            'message': f'语法错误: {e.msg}',
            'rule': 'syntax-error'
        })
        return issues

    # 2. 遍历 AST 检查常见问题
    class IssueVisitor(ast.NodeVisitor):
        def visit_Import(self, node):
            for alias in node.names:
                if alias.name in ('os', 'subprocess', 'shutil'):
                    if any(any('system' in line for line in code.split('\n')[node.lineno-1:node.end_lineno]) for _ in []):
                        pass
            self.generic_visit(node)

        def visit_Call(self, node):
            # eval() / exec() 检测
            if isinstance(node.func, ast.Name) and node.func.id in ('eval', 'exec', '__import__'):
                issues.append({
                    'severity': 'high',
                    'line': node.lineno,
                    'message': f'危险调用: {node.func.id}() 存在代码注入风险',
                    'rule': 'dangerous-function'
                })
            # subprocess 调用检测
            if hasattr(node.func, 'attr') and node.func.attr in ('call', 'Popen', 'run', 'check_output'):
                issues.append({
                    'severity': 'medium',
                    'line': node.lineno,
                    'message': f'子进程调用: {node.func.attr}()',
                    'rule': 'subprocess-use'
                })
            self.generic_visit(node)

        def visit_With(self, node):
            # 检查是否用了 context manager (文件操作等)
            for item in node.items:
                if isinstance(item.context_expr, ast.Call):
                    func = item.context_expr.func
                    if isinstance(func, ast.Name) and func.id == 'open':
                        return  # 用了 with open() - 没毛病
            self.generic_visit(node)

    try:
        IssueVisitor().visit(tree)
    except Exception:
        pass

    # 3. 正则检查常见问题
    lines = code.split('\n')
    patterns = [
        (r'password\s*=\s*["\x27][^"\x27]+["\x27]', 'high', '硬编码密钥'),
        (r'secret\s*=\s*["\x27][^"\x27]+["\x27]', 'high', '硬编码密钥'),
        (r'api_key\s*=\s*["\x27][^"\x27]+["\x27]', 'high', '硬编码密钥'),
        (r'print\s*\(\s*[\w\s,]*\b(password|secret|token|api_key)', 'medium', '日志输出敏感信息'),
        (r'except\s*:', 'low', '裸 except 捕获所有异常'),
        (r'except\s+Exception\s*:', 'low', 'Exception 范围过宽'),
        (r'time\.sleep\(', 'info', '使用了 sleep 阻塞'),
        (r'TODO|FIXME|HACK|XXX', 'info', '待办标记'),
        (r'\.read\(\)', 'medium', '大文件 read() 无参数可能导致内存溢出'),
        (r'=\s*\[\]\s*\n.*\.append\(', 'info', '可使用列表推导式优化'),
    ]

    for lin, line in enumerate(lines, 1):
        for pattern, severity, msg in patterns:
            if re.search(pattern, line):
                issues.append({
                    'severity': severity,
                    'line': lin,
                    'message': f'{msg}: {line.strip()[:60]}',
                    'rule': 'pattern-match'
                })
                break

    return issues


def lint_javascript(code):
    """JS/TS 静态检查"""
    issues = []
    lines = code.split('\n')

    patterns = [
        (r'console\.log', 'info', '生产环境 console.log 应移除'),
        (r'eval\(', 'high', 'eval() 存在代码注入风险'),
        (r'new Function\(', 'high', 'new Function() 等同 eval'),
        (r'document\.write\(', 'medium', 'document.write() 非标准'),
        (r'innerHTML\s*=', 'medium', 'innerHTML 赋值存在 XSS 风险'),
        (r'TODO|FIXME|HACK|XXX', 'info', '待办标记'),
        (r'var\s+\w+', 'info', '建议使用 const/let 替代 var'),
        (r'==(?!=)', 'low', '建议使用 === 严格相等'),
    ]

    for lin, line in enumerate(lines, 1):
        for pattern, severity, msg in patterns:
            if re.search(pattern, line):
                issues.append({
                    'severity': severity,
                    'line': lin,
                    'message': f'{msg}: {line.strip()[:60]}',
                    'rule': 'pattern-match'
                })
                break

    return issues


def main():
    try:
        input_data = json.load(sys.stdin)
        code = input_data.get('code', '')
        language = input_data.get('language', 'auto')

        if not code:
            print(json.dumps({
                'success': False,
                'output': 'Missing required parameter: code'
            }))
            return

        # 自动检测语言
        if language == 'auto':
            if any(kw in code for kw in ('def ', 'import ', 'class ', 'print(')):
                language = 'python'
            elif any(kw in code for kw in ('function', 'const ', 'let ', 'var ', '=>')):
                language = 'javascript'

        if language == 'python':
            issues = lint_python(code)
        elif language in ('javascript', 'typescript'):
            issues = lint_javascript(code)
        else:
            print(json.dumps({
                'success': False,
                'output': f'不支持的语言: {language}'
            }))
            return

        # 按严重度排序
        severity_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3, 'info': 4}
        issues.sort(key=lambda i: severity_order.get(i['severity'], 5))

        # 统计
        stats = {}
        for i in issues:
            sev = i['severity']
            stats[sev] = stats.get(sev, 0) + 1

        total = len(issues)
        if total == 0:
            output = "✅ 代码审查通过，未发现问题"
            print(json.dumps({
                'success': True,
                'output': output,
                'data': {'issues': [], 'total': 0, 'verdict': 'PASS'}
            }))
        else:
            severity_emoji = {'critical': '🔴', 'high': '🟠', 'medium': '🟡', 'low': '🟢', 'info': 'ℹ️'}
            lines = [f"代码审查: {total} 个问题"]
            for sev in ['critical', 'high', 'medium', 'low', 'info']:
                if sev in stats:
                    lines.append(f"  {severity_emoji[sev]} {sev}: {stats[sev]}")
            lines.append("\n前5个:")
            for issue in issues[:5]:
                lines.append(f"  L{issue['line']} [{issue['severity']}] {issue['message']}")

            output = '\n'.join(lines)
            print(json.dumps({
                'success': True,
                'output': output,
                'data': {
                    'issues': issues[:20],
                    'total': total,
                    'verdict': 'REVIEW_NEEDED' if any(i['severity'] in ('critical', 'high') for i in issues) else 'WARNING',
                    'stats': stats
                }
            }))

    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))

if __name__ == '__main__':
    main()
