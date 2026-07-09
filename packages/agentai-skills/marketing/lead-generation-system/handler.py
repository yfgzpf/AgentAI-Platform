#!/usr/bin/env python3
"""
Lead Generation System - 全渠道自动化获客系统
"""

import json
import sys
import os
from datetime import datetime, timedelta
import random


# 内容模板库
CONTENT_TEMPLATES = {
    "article": {
        "装修避坑": {
            "titles": [
                "装修小白必看！这10个坑千万别踩",
                "装修花了30万总结的血泪教训",
                "装修公司不会告诉你的5个秘密",
                "签装修合同前，这8个条款必须看清"
            ],
            "structure": ["痛点引入", "问题分析", "解决方案", "案例佐证", "行动号召"]
        },
        "风格指南": {
            "titles": [
                "2024年最流行的10种装修风格",
                "小户型显大秘籍：北欧风设计要点",
                "轻奢风装修：低预算也能出高级感",
                "新中式：传统与现代的完美融合"
            ],
            "structure": ["风格介绍", "核心元素", "配色方案", "案例展示", "预算参考"]
        },
        "材料选购": {
            "titles": [
                "瓷砖选购全攻略：看懂这6点不被坑",
                "地板怎么选？实木、复合、强化大对比",
                "乳胶漆选购指南：环保、耐擦洗、色彩",
                "橱柜定制避坑：板材、五金、计价方式"
            ],
            "structure": ["材料介绍", "选购要点", "品牌推荐", "价格区间", "注意事项"]
        }
    },
    "video": {
        "short": {
            "duration": 45,
            "structure": ["3秒钩子", "痛点共鸣", "解决方案", "引导关注"]
        },
        "medium": {
            "duration": 120,
            "structure": ["开场", "问题展示", "详细讲解", "案例对比", "总结"]
        }
    }
}


# 渠道配置
CHANNEL_CONFIG = {
    "wechat": {
        "name": "微信公众号",
        "best_times": ["12:00", "20:00"],
        "content_types": ["article", "image"],
        "avg_reach_rate": 0.15,
        "lead_conversion": 0.02
    },
    "douyin": {
        "name": "抖音",
        "best_times": ["07:00", "12:00", "18:00", "21:00"],
        "content_types": ["video"],
        "avg_reach_rate": 0.10,
        "lead_conversion": 0.01
    },
    "xiaohongshu": {
        "name": "小红书",
        "best_times": ["08:00", "12:00", "19:00", "22:00"],
        "content_types": ["image", "video"],
        "avg_reach_rate": 0.20,
        "lead_conversion": 0.03
    },
    "baidu": {
        "name": "百度",
        "best_times": ["全天"],
        "content_types": ["article"],
        "avg_reach_rate": 0.05,
        "lead_conversion": 0.04
    }
}


class LeadGenerationSystem:
    """获客系统核心类"""
    
    def __init__(self):
        self.leads_db = []
        self.content_history = []
    
    def generate_content_plan(self, topic: str, channels: list, days: int = 7) -> dict:
        """生成内容计划"""
        plan = {
            "period": f"{days}天",
            "topic": topic,
            "total_content": 0,
            "daily_plan": []
        }
        
        for day in range(days):
            date = (datetime.now() + timedelta(days=day)).strftime("%Y-%m-%d")
            daily_content = []
            
            for channel in channels:
                if channel not in CHANNEL_CONFIG:
                    continue
                
                config = CHANNEL_CONFIG[channel]
                
                # 根据渠道生成内容
                for content_type in config["content_types"]:
                    if content_type == "article":
                        content = self._generate_article(topic, channel)
                    elif content_type == "video":
                        content = self._generate_video_script(topic, channel)
                    elif content_type == "image":
                        content = self._generate_image_post(topic, channel)
                    else:
                        continue
                    
                    daily_content.append({
                        "channel": channel,
                        "type": content_type,
                        "content": content,
                        "publish_time": random.choice(config["best_times"]),
                        "estimated_reach": self._estimate_reach(channel),
                        "estimated_leads": self._estimate_leads(channel)
                    })
            
            plan["daily_plan"].append({
                "date": date,
                "content_count": len(daily_content),
                "content": daily_content
            })
            plan["total_content"] += len(daily_content)
        
        return plan
    
    def _generate_article(self, topic: str, channel: str) -> dict:
        """生成文章"""
        # 选择模板
        templates = CONTENT_TEMPLATES["article"]
        category = random.choice(list(templates.keys()))
        template = templates[category]
        
        title = random.choice(template["titles"])
        
        return {
            "title": title.replace("装修", topic) if topic != "装修" else title,
            "category": category,
            "structure": template["structure"],
            "word_count": random.randint(1500, 2500),
            "estimated_read_time": "5-8分钟",
            "keywords": [topic, category, "装修攻略"],
            "outline": self._generate_outline(template["structure"])
        }
    
    def _generate_video_script(self, topic: str, channel: str) -> dict:
        """生成视频脚本"""
        template = CONTENT_TEMPLATES["video"]["short"]
        
        return {
            "duration": template["duration"],
            "structure": template["structure"],
            "hook": f"你家{topic}踩坑了吗？",
            "script": self._generate_script_outline(template["structure"]),
            "bgm": "热门音乐推荐",
            "scenes": 5
        }
    
    def _generate_image_post(self, topic: str, channel: str) -> dict:
        """生成图文帖子"""
        return {
            "title": f"{topic}必看！",
            "image_count": random.randint(3, 9),
            "caption": self._generate_caption(topic),
            "hashtags": [f"#{topic}", "#装修", "#家居"],
            "call_to_action": "点击主页看更多案例"
        }
    
    def _generate_outline(self, structure: list) -> list:
        """生成文章大纲"""
        return [{"section": s, "points": ["要点1", "要点2", "要点3"]} for s in structure]
    
    def _generate_script_outline(self, structure: list) -> list:
        """生成脚本大纲"""
        return [{"scene": i+1, "content": s, "duration": "10s"} for i, s in enumerate(structure)]
    
    def _generate_caption(self, topic: str) -> str:
        """生成图文描述"""
        templates = [
            f"{topic}真的太重要了！今天分享几个实用技巧，建议收藏~",
            f"做了10年装修，总结出的{topic}经验，看完少踩坑！",
            f"{topic}怎么做？看这一篇就够了！"
        ]
        return random.choice(templates)
    
    def _estimate_reach(self, channel: str) -> int:
        """估算曝光量"""
        base_reach = {
            "wechat": 5000,
            "douyin": 10000,
            "xiaohongshu": 3000,
            "baidu": 2000
        }
        return int(base_reach.get(channel, 1000) * random.uniform(0.8, 1.2))
    
    def _estimate_leads(self, channel: str) -> int:
        """估算线索数"""
        reach = self._estimate_reach(channel)
        conversion = CHANNEL_CONFIG.get(channel, {}).get("lead_conversion", 0.01)
        return int(reach * conversion * random.uniform(0.5, 1.5))
    
    def analyze_channels(self) -> dict:
        """分析各渠道效果"""
        analysis = {}
        
        for channel, config in CHANNEL_CONFIG.items():
            # 模拟历史数据
            monthly_content = random.randint(10, 30)
            monthly_reach = self._estimate_reach(channel) * monthly_content
            monthly_leads = self._estimate_leads(channel) * monthly_content
            
            analysis[channel] = {
                "name": config["name"],
                "monthly_content": monthly_content,
                "monthly_reach": monthly_reach,
                "monthly_leads": monthly_leads,
                "lead_cost": random.randint(50, 300),
                "conversion_rate": f"{config['lead_conversion']*100:.1f}%",
                "roi": random.uniform(3, 8),
                "recommendation": self._channel_recommendation(channel, monthly_leads)
            }
        
        return analysis
    
    def _channel_recommendation(self, channel: str, leads: int) -> str:
        """渠道建议"""
        if leads > 50:
            return "重点投入渠道，建议增加内容产出"
        elif leads > 20:
            return "稳定渠道，保持现有投入"
        else:
            return "效果一般，建议优化内容策略"
    
    def generate_lead_report(self, days: int = 7) -> dict:
        """生成线索报告"""
        total_leads = random.randint(30, 100)
        
        return {
            "period": f"近{days}天",
            "total_leads": total_leads,
            "daily_average": round(total_leads / days, 1),
            "lead_sources": {
                "wechat": int(total_leads * 0.4),
                "douyin": int(total_leads * 0.3),
                "xiaohongshu": int(total_leads * 0.2),
                "others": int(total_leads * 0.1)
            },
            "lead_quality": {
                "high": int(total_leads * 0.2),
                "medium": int(total_leads * 0.5),
                "low": int(total_leads * 0.3)
            },
            "conversion_forecast": {
                "estimated_visits": int(total_leads * 0.3),
                "estimated_signs": int(total_leads * 0.1),
                "estimated_revenue": int(total_leads * 0.1 * 150000)
            }
        }


def main():
    try:
        input_data = json.load(sys.stdin)
        
        action = input_data.get("action", "generate_content_plan")
        system = LeadGenerationSystem()
        
        if action == "generate_content_plan":
            topic = input_data.get("topic", "装修")
            channels = input_data.get("channels", ["wechat", "douyin", "xiaohongshu"])
            days = input_data.get("days", 7)
            
            plan = system.generate_content_plan(topic, channels, days)
            
            # 计算总计
            total_reach = sum(
                content["estimated_reach"]
                for day in plan["daily_plan"]
                for content in day["content"]
            )
            total_leads = sum(
                content["estimated_leads"]
                for day in plan["daily_plan"]
                for content in day["content"]
            )
            
            output = f"""📅 {days}天内容获客计划

🎯 主题: {topic}
📊 内容总量: {plan['total_content']} 篇/条
👥 预计曝光: {total_reach:,} 人次
🎯 预计线索: {total_leads} 个

📋 每日计划:
"""
            for day in plan["daily_plan"]:
                output += f"\n📆 {day['date']} ({day['content_count']}条内容)\n"
                for content in day["content"]:
                    ch_name = CHANNEL_CONFIG.get(content['channel'], {}).get('name', content['channel'])
                    output += f"   • {ch_name}: {content['content'].get('title', content['type'])}\n"
                    output += f"     预计曝光: {content['estimated_reach']:,} | 预计线索: {content['estimated_leads']}\n"
            
            result = {
                "success": True,
                "output": output,
                "data": plan
            }
        
        elif action == "analyze_channels":
            analysis = system.analyze_channels()
            
            output = "📊 渠道效果分析\n\n"
            for channel, data in analysis.items():
                output += f"📱 {data['name']}\n"
                output += f"   月产出: {data['monthly_content']} 条\n"
                output += f"   月曝光: {data['monthly_reach']:,} 人次\n"
                output += f"   月线索: {data['monthly_leads']} 个\n"
                output += f"   线索成本: ¥{data['lead_cost']}\n"
                output += f"   ROI: 1:{data['roi']:.1f}\n"
                output += f"   建议: {data['recommendation']}\n\n"
            
            result = {
                "success": True,
                "output": output,
                "data": analysis
            }
        
        elif action == "generate_lead_report":
            days = input_data.get("days", 7)
            report = system.generate_lead_report(days)
            
            output = f"""📈 线索获取报告（{report['period']}）

📊 总体数据:
   总线索数: {report['total_leads']} 个
   日均线索: {report['daily_average']} 个

📱 渠道分布:
"""
            for source, count in report['lead_sources'].items():
                ch_name = CHANNEL_CONFIG.get(source, {}).get('name', source)
                percentage = count / report['total_leads'] * 100
                output += f"   • {ch_name}: {count} 个 ({percentage:.0f}%)\n"
            
            output += f"""
🎯 线索质量:
   高意向: {report['lead_quality']['high']} 个
   中意向: {report['lead_quality']['medium']} 个
   低意向: {report['lead_quality']['low']} 个

💰 转化预测:
   预计到店: {report['conversion_forecast']['estimated_visits']} 人
   预计签约: {report['conversion_forecast']['estimated_signs']} 单
   预计营收: ¥{report['conversion_forecast']['estimated_revenue']:,}
"""
            
            result = {
                "success": True,
                "output": output,
                "data": report
            }
        
        else:
            result = {
                "success": False,
                "error": f"未知 action: {action}"
            }
        
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
