#!/usr/bin/env python3
"""
Email Skill Handler
邮件发送 — 支持 SMTP 发送、模板填写、批量发送
"""

import json
import sys
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders


def send_email(smtp_config, to, subject, body, html_body=None, attachments=None):
    """通过 SMTP 发送邮件"""
    server = smtplib.SMTP(smtp_config['host'], smtp_config.get('port', 587), timeout=30)
    try:
        server.ehlo()
        if smtp_config.get('use_tls', True):
            server.starttls()
            server.ehlo()
        if smtp_config.get('username'):
            server.login(smtp_config['username'], smtp_config['password'])

        msg = MIMEMultipart()
        msg['From'] = smtp_config.get('from', smtp_config.get('username', ''))
        msg['To'] = ', '.join(to) if isinstance(to, list) else to
        msg['Subject'] = subject

        # 纯文本
        msg.attach(MIMEText(body, 'plain', 'utf-8'))

        # HTML 版本
        if html_body:
            msg.attach(MIMEText(html_body, 'html', 'utf-8'))

        # 附件
        if attachments:
            for att in attachments:
                with open(att['path'], 'rb') as f:
                    part = MIMEBase('application', 'octet-stream')
                    part.set_payload(f.read())
                    encoders.encode_base64(part)
                    part.add_header('Content-Disposition', f'attachment; filename="{att.get("filename", att["path"].split("/")[-1])}"')
                    msg.attach(part)

        server.send_message(msg)
        return True, None
    finally:
        server.quit()


def validate_email(email_str):
    """简单邮箱校验"""
    import re
    pattern = r'^[\w\.-]+@[\w\.-]+\.\w+$'
    return bool(re.match(pattern, email_str))


def main():
    try:
        input_data = json.load(sys.stdin)
        action = input_data.get('action', 'send')

        if action == 'send':
            to = input_data.get('to', [])
            subject = input_data.get('subject', '')
            body = input_data.get('body', '')

            if not to:
                print(json.dumps({
                    'success': False,
                    'output': 'Missing required parameter: to'
                }))
                return
            if not subject:
                print(json.dumps({
                    'success': False,
                    'output': 'Missing required parameter: subject'
                }))
                return

            # 收件人校验
            if isinstance(to, str):
                to = [to]
            invalid = [t for t in to if not validate_email(t)]
            if invalid:
                print(json.dumps({
                    'success': False,
                    'output': f'无效的邮箱地址: {", ".join(invalid)}'
                }))
                return

            # SMTP 配置 (支持常见邮箱)
            smtp_config = input_data.get('smtp', {})
            if not smtp_config:
                # 尝试从常见已配置的邮箱推断
                domain = to[0].split('@')[1].lower() if to else 'qq.com'
                smtp_map = {
                    'qq.com': {'host': 'smtp.qq.com', 'port': 587},
                    '163.com': {'host': 'smtp.163.com', 'port': 465},
                    '126.com': {'host': 'smtp.126.com', 'port': 465},
                    'gmail.com': {'host': 'smtp.gmail.com', 'port': 587},
                    'outlook.com': {'host': 'smtp-mail.outlook.com', 'port': 587},
                    'hotmail.com': {'host': 'smtp-mail.outlook.com', 'port': 587},
                }
                smtp_config = smtp_map.get(domain, {'host': 'smtp.qq.com', 'port': 587})

            if not smtp_config.get('from'):
                smtp_config['from'] = input_data.get('from', '')

            # 检查是否需要认证
            is_local = smtp_config.get('host', '') in ('localhost', '127.0.0.1')
            if not is_local and not smtp_config.get('password'):
                print(json.dumps({
                    'success': False,
                    'output': '需要 SMTP 认证信息: smtp.password (或使用本地 SMTP: smtp.host=localhost)'
                }))
                return

            ok, error = send_email(
                smtp_config,
                to,
                subject,
                body,
                html_body=input_data.get('html_body'),
                attachments=input_data.get('attachments'),
            )

            if ok:
                print(json.dumps({
                    'success': True,
                    'output': f"邮件发送成功 → {', '.join(to)}",
                    'data': {'to': to, 'subject': subject}
                }))
            else:
                print(json.dumps({
                    'success': False,
                    'output': f'发送失败: {error}'
                }))

        elif action == 'test':
            print(json.dumps({
                'success': True,
                'output': 'Email 技能就绪 — 使用 action=send 发送邮件',
                'data': {
                    'supported_actions': ['send', 'test'],
                    'smtp_hints': {
                        'qq': 'host=smtp.qq.com, port=587, 需开启POP3/SMTP获取授权码',
                        '163': 'host=smtp.163.com, port=465, 需开启POP3/SMTP获取授权码',
                        'gmail': 'host=smtp.gmail.com, port=587, 需开启应用专用密码',
                    }
                }
            }))
        else:
            print(json.dumps({
                'success': False,
                'output': f'不支持的操作: {action}'
            }))

    except smtplib.SMTPAuthenticationError:
        print(json.dumps({
            'success': False,
            'output': 'SMTP 认证失败 — 请检查用户名/密码/授权码'
        }))
    except smtplib.SMTPException as e:
        print(json.dumps({
            'success': False,
            'output': f'SMTP 错误: {str(e)}'
        }))
    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))

if __name__ == '__main__':
    main()
