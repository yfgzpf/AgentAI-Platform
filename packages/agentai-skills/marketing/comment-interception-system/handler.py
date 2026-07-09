#!/usr/bin/env python3
"""
Comment Interception System - 评论区截流获客系统
2024年最有效的低成本获客黑科技
"""

import json
import sys
import re
from datetime import datetime
from typing import List, Dict


class CommentInterceptionSystem:
    """评论区截流系统核心类"""
    
    def __init__(self):
        # 高意向关键词
        self.intent_keywords = {
            "high": ["求推荐", "哪家好", "怎么联系", "多少钱", "报价", "预算", "想做", "准备装修"],
            "medium": ["不错", "好看", "喜欢", "参考", "学习", "收藏"],
            "location": ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京"]
        }
        
        # 模拟数据库
        self.mock_data = {
            "videos": [],
            "comments": [],
            "users": []
        }
    
    def start_monitoring(self, context: Dict) -> Dict:
        """开始监控"""
        platform = context.get("platform", "douyin")
        keywords = context.get("keywords", ["装修"])
        city = context.get("city", "")
        
        # 模拟监控结果
        mock_videos = self._generate_mock_videos(platform, keywords, city)
        
        # 采集评论
        all_comments = []
        high_intent_users = []
        
        for video in mock_videos:
            comments = self._generate_mock_comments(video)
            all_comments.extend(comments)
            
            # 识别高意向用户
            for comment in comments:
                intent_score = self._calculate_intent_score(comment["content"])
                if intent_score >= 7:
                    comment["intent_score"] = intent_score
                    comment["suggested_message"] = self._generate_private_message(
                        comment["content"], 
                        comment["username"]
                    )
                    high_intent_users.append(comment)
        
        # 按意向分数排序
        high_intent_users.sort(key=lambda x: x["intent_score"], reverse=True)
        
        return {
            "platform": platform,
            "keywords": keywords,
            "city": city,
            "videos_monitored": len(mock_videos),
            "comments_collected": len(all_comments),
            "high_intent_count": len(high_intent_users),
            "high_intent_users": high_intent_users[:10],  # 只返回前10个
            "monitoring_status": "running",
            "next_check": (datetime.now().replace(minute=0, second=0) + 
                          __import__('datetime').timedelta(hours=1)).strftime("%H:%M")
        }
    
    def _generate_mock_videos(self, platform: str, keywords: List[str], city: str) -> List[Dict]:
        """生成模拟视频数据"""
        videos = []
        
        titles = [
            f"{city}装修花了30万，这些坑千万别踩" if city else "装修花了30万，这些坑千万别踩",
            f"{city}90后夫妻爆改老破小，效果惊艳" if city else "90后夫妻爆改老破小",
            "2024装修报价清单，这3项至少省30%",
            "装修公司不会告诉你的8个秘密",
            f"{city}最值得推荐的5家装修公司" if city else "最值得推荐的5家装修公司"
        ]
        
        for i, title in enumerate(titles):
            videos.append({
                "id": f"video_{i}",
                "platform": platform,
                "title": title,
                "author": f"装修达人{i}",
                "views": f"{50 + i * 30}万",
                "comments": 150 + i * 50,
                "likes": f"{2 + i}万",
                "url": f"https://{platform}.com/video/{i}"
            })
        
        return videos
    
    def _generate_mock_comments(self, video: Dict) -> List[Dict]:
        """生成模拟评论数据"""
        comments = []
        
        # 高意向评论模板
        high_intent_templates = [
            "{city}有靠谱的装修公司推荐吗？",
            "我家也要装修了，求推荐",
            "100平大概要多少钱？",
            "正在找装修公司，哪家好？",
            "可以私信联系方式吗？",
            "设计费怎么算的？",
            "{city}的，想了解一下",
            "准备装修，怕被坑",
            "全包还是半包好？",
            "有{city}的装修公司吗？"
        ]
        
        # 中等意向评论
        medium_intent_templates = [
            "收藏了，以后参考",
            "装修得真好看",
            "学习了",
            "不错不错",
            "很有用"
        ]
        
        city = video.get("city", "")
        
        # 生成25条评论
        for i in range(25):
            if i < 10:  # 40%高意向
                template = high_intent_templates[i % len(high_intent_templates)]
                content = template.format(city=city) if "{city}" in template else template
            else:  # 60%其他
                template = medium_intent_templates[i % len(medium_intent_templates)]
                content = template
            
            comments.append({
                "id": f"comment_{video['id']}_{i}",
                "video_id": video["id"],
                "video_title": video["title"],
                "username": f"用户{10000 + i}",
                "content": content,
                "likes": 5 + i * 2,
                "time": f"{i}小时前"
            })
        
        return comments
    
    def _calculate_intent_score(self, comment: str) -> int:
        """计算意向分数"""
        score = 5  # 基础分
        
        # 高意向关键词 +3分
        for keyword in self.intent_keywords["high"]:
            if keyword in comment:
                score += 3
        
        # 中等意向关键词 +1分
        for keyword in self.intent_keywords["medium"]:
            if keyword in comment:
                score += 1
        
        # 地域词 +2分（说明是本地客户）
        for keyword in self.intent_keywords["location"]:
            if keyword in comment:
                score += 2
        
        return min(score, 10)  # 最高10分
    
    def _generate_private_message(self, comment: str, username: str) -> str:
        """生成私信话术"""
        
        # 根据评论内容生成个性化话术
        if "多少钱" in comment or "报价" in comment or "预算" in comment:
            return f"您好！看到您在了解装修报价，我们可以免费上门量房出详细报价单，没有增项，需要的话可以加微信详聊~"
        
        if "推荐" in comment or "哪家好" in comment:
            return f"您好！我们在本地做了8年装修，服务过2000+业主，口碑很好。可以先看看我们的案例，满意再决定~"
        
        if "怕被坑" in comment or "避坑" in comment:
            return f"理解您的担心！我们承诺0增项，合同价就是最终价。可以先免费量房出方案，满意再签约，没有任何风险~"
        
        if "设计" in comment:
            return f"您好！我们首席设计师有10年经验，可以免费出3套设计方案。方便的话加微信，发您一些案例参考~"
        
        # 默认话术
        return f"您好！看到您在关注装修，我们在本地做了8年，口碑很好。可以免费量房出方案，需要的话随时联系~"
    
    def generate_message(self, context: Dict) -> Dict:
        """生成私信话术"""
        user_comment = context.get("user_comment", "")
        platform = context.get("platform", "douyin")
        
        message = self._generate_private_message(user_comment, "")
        
        # 根据平台调整话术
        if platform == "xiaohongshu":
            message += " 📱"
        
        return {
            "original_comment": user_comment,
            "platform": platform,
            "suggested_message": message,
            "alternative_messages": [
                "您好！看到您在找装修公司，我们在本地口碑很好，可以先看看案例~",
                "理解您的需求！我们可以免费量房出方案，满意再决定，没有任何风险~"
            ],
            "tips": [
                "发送时间：工作日晚8-10点效果最佳",
                "避免频繁发送，每小时不超过5条",
                "如果对方回复，及时跟进"
            ]
        }
    
    def view_results(self, context: Dict) -> Dict:
        """查看监控结果"""
        date = context.get("date", datetime.now().strftime("%Y-%m-%d"))
        min_score = context.get("min_intent_score", 7)
        
        # 模拟历史数据
        return {
            "date": date,
            "summary": {
                "videos_monitored": 156,
                "comments_collected": 3892,
                "high_intent_users": 127,
                "messages_sent": 45,
                "responses_received": 12,
                "wechat_added": 8,
                "conversion_rate": "17.8%"
            },
            "top_users": [
                {
                    "username": "准备装修的小王",
                    "comment": "北京100平房子装修要多少钱？",
                    "intent_score": 10,
                    "status": "已私信",
                    "response": "已回复，加了微信"
                },
                {
                    "username": "装修小白",
                    "comment": "求推荐靠谱的装修公司，怕被坑",
                    "intent_score": 10,
                    "status": "已私信",
                    "response": "待回复"
                }
            ]
        }


def main():
    try:
        input_data = json.load(sys.stdin)
        action = input_data.get("action", "")
        context = input_data.get("context", {})
        
        system = CommentInterceptionSystem()
        
        if action == "start_monitoring":
            result = system.start_monitoring(context)
        elif action == "generate_message":
            result = system.generate_message(context)
        elif action == "view_results":
            result = system.view_results(context)
        else:
            result = {"error": f"Unknown action: {action}"}
        
        # 格式化输出
        output = {
            "success": "error" not in result,
            "output": format_output(action, result),
            "data": result
        }
        
        print(json.dumps(output, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


def format_output(action: str, result: Dict) -> str:
    """格式化输出"""
    if "error" in result:
        return f"❌ 错误: {result['error']}"
    
    if action == "start_monitoring":
        lines = [
            f"🎯 评论区截流监控已启动",
            f"",
            f"📊 监控概况:",
            f"  • 平台: {result['platform']}",
            f"  • 关键词: {', '.join(result['keywords'])}",
            f"  • 地域: {result['city'] or '全国'}",
            f"",
            f"📈 本次扫描结果:",
            f"  • 监控视频: {result['videos_monitored']} 个",
            f"  • 采集评论: {result['comments_collected']} 条",
            f"  • 高意向用户: {result['high_intent_count']} 人",
            f"",
            f"👥 高意向用户TOP5:"
        ]
        
        for i, user in enumerate(result['high_intent_users'][:5], 1):
            lines.append(f"  {i}. {user['username']} (意向分: {user['intent_score']})")
            lines.append(f"     评论: {user['content'][:30]}...")
            lines.append(f"     话术: {user['suggested_message'][:40]}...")
            lines.append("")
        
        lines.append(f"⏰ 下次检查: {result['next_check']}")
        lines.append(f"💡 提示: 建议立即私信高意向用户，转化率最高")
        
        return "\n".join(lines)
    
    elif action == "generate_message":
        return f"""💬 私信话术已生成

原评论: {result['original_comment']}

📝 推荐话术:
{result['suggested_message']}

💡 发送建议:
{chr(10).join('• ' + tip for tip in result['tips'])}
"""
    
    elif action == "view_results":
        summary = result['summary']
        return f"""📊 {result['date']} 监控数据

📈 总体数据:
  • 监控视频: {summary['videos_monitored']} 个
  • 采集评论: {summary['comments_collected']} 条
  • 高意向用户: {summary['high_intent_users']} 人
  • 私信发送: {summary['messages_sent']} 条
  • 收到回复: {summary['responses_received']} 条
  • 加微信: {summary['wechat_added']} 人
  • 转化率: {summary['conversion_rate']}

💰 效果评估:
  按获客成本¥50/人计算，今日价值: ¥{summary['wechat_added'] * 50}
"""
    
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
