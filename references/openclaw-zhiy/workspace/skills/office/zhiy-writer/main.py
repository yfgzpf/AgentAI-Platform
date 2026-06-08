#!/usr/bin/env python3
"""
智 Y 写作技能
支持多种文档类型的智能生成
"""

import argparse
import json
import os
import sys
from datetime import datetime

try:
    from openai import OpenAI
except ImportError:
    print("请安装 openai: pip install openai", file=sys.stderr)
    sys.exit(1)

def get_client():
    api_key = os.environ.get('DEEPSEEK_API_KEY')
    if not api_key:
        raise ValueError("请设置 DEEPSEEK_API_KEY 环境变量")
    
    return OpenAI(
        api_key=api_key,
        base_url="https://api.deepseek.com/v1"
    )

def generate_content(client, doc_type: str, topic: str, content: str = "", style: str = "formal") -> str:
    style_prompts = {
        "formal": "正式、专业的商务风格",
        "casual": "轻松、口语化的风格",
        "creative": "创意、富有想象力的风格"
    }
    
    type_prompts = {
        "article": "文章",
        "report": "报告",
        "contract": "合同",
        "script": "剧本"
    }
    
    system_prompt = f"""你是一个专业的{type_prompts.get(doc_type, '文档')}撰写助手。
请用{style_prompts.get(style, '正式风格')}撰写内容。
输出格式要求：
1. 使用Markdown格式
2. 结构清晰，层次分明
3. 内容详实，逻辑连贯"""

    user_prompt = f"请撰写一篇关于「{topic}」的{type_prompts.get(doc_type, '文档')}。"
    if content:
        user_prompt += f"\n\n内容要求：\n{content}"
    
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.7,
        max_tokens=4096
    )
    
    return response.choices[0].message.content

def main():
    parser = argparse.ArgumentParser(description='智 Y 写作技能')
    parser.add_argument('--type', required=True, choices=['article', 'report', 'contract', 'script'])
    parser.add_argument('--topic', required=True)
    parser.add_argument('--content', default='')
    parser.add_argument('--style', default='formal', choices=['formal', 'casual', 'creative'])
    parser.add_argument('--output', required=True)
    
    args = parser.parse_args()
    
    try:
        client = get_client()
        content = generate_content(client, args.type, args.topic, args.content, args.style)
        
        output_dir = os.path.dirname(args.output)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(content)
        
        result = {
            "status": "success",
            "data": {
                "file_path": os.path.abspath(args.output),
                "word_count": len(content),
                "timestamp": datetime.now().isoformat()
            },
            "message": f"{args.type} 生成成功"
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")
        
    except Exception as e:
        result = {
            "status": "error",
            "message": str(e)
        }
        print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
