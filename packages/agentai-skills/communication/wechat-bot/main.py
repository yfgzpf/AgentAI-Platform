
#!/usr/bin/env python3
"""
微信机器人技能 - 消息自动回复和智能问答
支持多场景自动回复
"""

import argparse
import json
import sys
import time
from pathlib import Path
from datetime import datetime

try:
    import requests
except ImportError:
    print("请先安装依赖: pip install requests")
    sys.exit(1)


class WeChatBot:
    def __init__(self, config_path=None):
        self.config = self._load_config(config_path)
        self.auto_reply_rules = self.config.get('auto_reply', {})
        self.keyword_replies = self.config.get('keyword_replies', {})
        self.session_file = Path(self.config.get('session_path', 'wechat_session.json'))
        self.session = self._load_session()

    def _load_config(self, config_path):
        default_config = {
            'auto_reply': {
                'enabled': True,
                'default_reply': '您好，我现在有点忙，稍后回复您。',
                'working_hours': {'start': 9, 'end': 18}
            },
            'keyword_replies': {},
            'session_path': 'wechat_session.json'
        }
        
        if config_path and Path(config_path).exists():
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    user_config = json.load(f)
                    default_config.update(user_config)
            except Exception as e:
                print(f"警告: 无法读取配置文件: {e}", file=sys.stderr)
        
        return default_config

    def _load_session(self):
        if self.session_file.exists():
            try:
                with open(self.session_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"警告: 无法读取会话记录: {e}", file=sys.stderr)
        return {'messages': [], 'contacts': {}}

    def _save_session(self):
        try:
            self.session_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.session_file, 'w', encoding='utf-8') as f:
                json.dump(self.session, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"警告: 无法保存会话记录: {e}", file=sys.stderr)

    def is_working_hours(self):
        if not self.config['auto_reply'].get('check_working_hours', False):
            return True
        now = datetime.now()
        start = self.config['auto_reply']['working_hours']['start']
        end = self.config['auto_reply']['working_hours']['end']
        return start &lt;= now.hour &lt; end

    def get_auto_reply(self, message, sender=None):
        if not self.config['auto_reply']['enabled']:
            return None

        if not self.is_working_hours():
            return self.config['auto_reply'].get('off_hours_reply', 
                                                 '您好，现在是非工作时间，我会在工作时间回复您。')

        for keyword, reply in self.keyword_replies.items():
            if keyword.lower() in message.lower():
                return reply

        if sender:
            contact = self.session['contacts'].get(sender, {})
            if contact.get('auto_reply'):
                return contact['auto_reply']

        return self.config['auto_reply']['default_reply']

    def process_message(self, message, sender=None, group=None):
        timestamp = datetime.now().isoformat()
        
        msg_record = {
            'timestamp': timestamp,
            'message': message,
            'sender': sender,
            'group': group
        }
        self.session['messages'].append(msg_record)
        
        if len(self.session['messages']) &gt; 1000:
            self.session['messages'] = self.session['messages'][-500:]
        
        self._save_session()

        reply = self.get_auto_reply(message, sender)
        
        if reply:
            return reply
        
        return None

    def add_keyword_reply(self, keyword, reply):
        self.keyword_replies[keyword] = reply
        self._save_session()
        return True

    def remove_keyword_reply(self, keyword):
        if keyword in self.keyword_replies:
            del self.keyword_replies[keyword]
            self._save_session()
            return True
        return False

    def get_conversation_history(self, limit=50):
        return self.session['messages'][-limit:]

    def clear_history(self):
        self.session['messages'] = []
        self._save_session()
        return True


def main():
    parser = argparse.ArgumentParser(description='微信机器人')
    subparsers = parser.add_subparsers(dest='command', help='命令')

    reply_parser = subparsers.add_parser('reply', help='获取自动回复')
    reply_parser.add_argument('--message', required=True, help='收到的消息')
    reply_parser.add_argument('--sender', help='发送者')
    reply_parser.add_argument('--group', help='群组')
    reply_parser.add_argument('--config', help='配置文件路径')

    addkw_parser = subparsers.add_parser('add-keyword', help='添加关键词回复')
    addkw_parser.add_argument('--keyword', required=True, help='关键词')
    addkw_parser.add_argument('--reply', required=True, help='回复内容')
    addkw_parser.add_argument('--config', help='配置文件路径')

    rmkw_parser = subparsers.add_parser('remove-keyword', help='删除关键词回复')
    rmkw_parser.add_argument('--keyword', required=True, help='关键词')
    rmkw_parser.add_argument('--config', help='配置文件路径')

    history_parser = subparsers.add_parser('history', help='查看历史记录')
    history_parser.add_argument('--limit', type=int, default=50, help='记录数量')
    history_parser.add_argument('--config', help='配置文件路径')

    clear_parser = subparsers.add_parser('clear', help='清空历史记录')
    clear_parser.add_argument('--config', help='配置文件路径')

    args = parser.parse_args()

    bot = WeChatBot(config_path=args.config)

    if args.command == 'reply':
        reply = bot.process_message(args.message, args.sender, args.group)
        if reply:
            print(reply)
            print(f"\n##RESULT## {json.dumps({'reply': reply}, ensure_ascii=False)}", file=sys.stderr)
        else:
            print("##RESULT## 无需回复", file=sys.stderr)
    
    elif args.command == 'add-keyword':
        if bot.add_keyword_reply(args.keyword, args.reply):
            print(f"已添加关键词回复: {args.keyword}")
            print("##RESULT## 成功", file=sys.stderr)
    
    elif args.command == 'remove-keyword':
        if bot.remove_keyword_reply(args.keyword):
            print(f"已删除关键词回复: {args.keyword}")
            print("##RESULT## 成功", file=sys.stderr)
        else:
            print(f"未找到关键词: {args.keyword}", file=sys.stderr)
            sys.exit(1)
    
    elif args.command == 'history':
        history = bot.get_conversation_history(args.limit)
        for msg in history:
            print(f"[{msg['timestamp']}] {msg.get('sender', '未知')}: {msg['message']}")
        print(f"\n##RESULT## 共 {len(history)} 条记录", file=sys.stderr)
    
    elif args.command == 'clear':
        if bot.clear_history():
            print("已清空历史记录")
            print("##RESULT## 成功", file=sys.stderr)
    
    else:
        parser.print_help()


if __name__ == '__main__':
    main()

