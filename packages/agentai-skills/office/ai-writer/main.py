
#!/usr/bin/env python3
"""
AI Writer 技能 - 智能文案生成
支持多种文案类型和风格定制
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("请先安装依赖: pip install requests")
    sys.exit(1)


class AIWriter:
    def __init__(self, api_key=None, api_url=None, model="deepseek-chat"):
        self.api_key = api_key
        self.api_url = api_url or "https://api.deepseek.com/v1/chat/completions"
        self.model = model

    def generate_content(self, prompt, content_type, style, length="medium"):
        system_prompt = self._get_system_prompt(content_type, style, length)
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]

        try:
            response = requests.post(
                self.api_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens": 2000
                },
                timeout=60
            )
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"]
        except Exception as e:
            return f"生成失败: {str(e)}"

    def _get_system_prompt(self, content_type, style, length):
        type_descriptions = {
            "article": "专业文章，结构清晰，逻辑严密",
            "essay": "议论文，观点明确，论据充分",
            "report": "报告文体，数据详实，结论清晰",
            "email": "商务邮件，礼貌专业，简洁明了",
            "social": "社交媒体文案，活泼有趣，易于传播",
            "marketing": "营销文案，有说服力，促进转化",
            "story": "故事创作，情节生动，人物丰满"
        }

        style_descriptions = {
            "professional": "专业正式，适合商务场合",
            "casual": "轻松随意，像朋友聊天",
            "humorous": "幽默风趣，引人发笑",
            "elegant": "优雅精致，文字优美",
            "simple": "简洁明了，通俗易懂",
            "scholarly": "学术严谨，引用规范"
        }

        length_descriptions = {
            "short": "简短精炼，100-300字",
            "medium": "中等篇幅，300-800字",
            "long": "长篇大论，800字以上"
        }

        desc = type_descriptions.get(content_type, "通用文案")
        style_desc = style_descriptions.get(style, "中性风格")
        length_desc = length_descriptions.get(length, "中等篇幅")

        return f"""你是一个专业的文案写作助手。

写作要求：
- 内容类型: {desc}
- 写作风格: {style_desc}
- 篇幅要求: {length_desc}

请根据用户的需求，生成高质量的文案内容。输出格式为纯文本，不要使用Markdown格式。"""

    def save_to_file(self, content, output_path):
        try:
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        except Exception as e:
            print(f"保存失败: {e}", file=sys.stderr)
            return False


def main():
    parser = argparse.ArgumentParser(description='AI 智能文案生成')
    parser.add_argument('--prompt', required=True, help='写作需求或主题')
    parser.add_argument('--type', default='article', 
                       choices=['article', 'essay', 'report', 'email', 'social', 'marketing', 'story'],
                       help='文案类型')
    parser.add_argument('--style', default='professional',
                       choices=['professional', 'casual', 'humorous', 'elegant', 'simple', 'scholarly'],
                       help='写作风格')
    parser.add_argument('--length', default='medium',
                       choices=['short', 'medium', 'long'],
                       help='篇幅长度')
    parser.add_argument('--api-key', help='API 密钥')
    parser.add_argument('--api-url', help='API 地址')
    parser.add_argument('--model', default='deepseek-chat', help='模型名称')
    parser.add_argument('--output', help='输出文件路径')
    parser.add_argument('--config', help='配置文件路径')

    args = parser.parse_args()

    api_key = args.api_key
    api_url = args.api_url

    if args.config:
        try:
            with open(args.config, 'r', encoding='utf-8') as f:
                config = json.load(f)
                api_key = api_key or config.get('api_key')
                api_url = api_url or config.get('api_url')
        except Exception as e:
            print(f"警告: 无法读取配置文件: {e}", file=sys.stderr)

    if not api_key:
        print("错误: 需要提供 API 密钥", file=sys.stderr)
        print("使用 --api-key 参数或配置文件", file=sys.stderr)
        sys.exit(1)

    writer = AIWriter(api_key=api_key, api_url=api_url, model=args.model)
    
    print("正在生成文案...", file=sys.stderr)
    content = writer.generate_content(
        prompt=args.prompt,
        content_type=args.type,
        style=args.style,
        length=args.length
    )

    print(content)

    if args.output:
        if writer.save_to_file(content, args.output):
            print(f"\n##RESULT## 成功保存到: {args.output}", file=sys.stderr)
        else:
            sys.exit(1)
    else:
        print("\n##RESULT## 成功", file=sys.stderr)


if __name__ == '__main__':
    main()

