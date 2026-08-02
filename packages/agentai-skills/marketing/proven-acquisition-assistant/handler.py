#!/usr/bin/env python3
"""
Proven Acquisition Assistant - 成熟获客方法AI助手
辅助人工执行经过验证的获客策略
"""

import json
import sys
from datetime import datetime, timedelta


class ReferralAssistant:
    """老客户转介绍助手"""
    
    def generate_script(self, context: dict) -> dict:
        """生成转介绍话术"""
        customer = context.get("customer_name", "客户")
        project = context.get("project_type", "装修")
        days = context.get("days_after_completion", 3)
        
        scripts = {
            "phone": f"""{customer}您好，我是XX装饰的小李。

您家{project}完工{days}天了，住得还满意吗？有没有什么问题需要处理的？

（等客户回答）

太感谢您选择我们！如果您觉得我们服务还不错，身边有朋友需要装修的话，可以推荐给我们。

我们给推荐的朋友准备了专属优惠：设计费全免+主材9折。

给您也准备了一份心意：推荐成功送全屋美缝（价值2000元）。

您看最近有朋友在装修吗？""",
            
            "wechat": f"""{customer}您好！

您家装修完工几天了，还满意吗？🙂

如果效果不错，方便的话帮我推荐几个朋友呗～

推荐有礼🎁：
• 您的朋友：设计费全免
• 您本人：全屋美缝（价值2000元）

身边有装修需求的朋友吗？""",
            
            "follow_up": f"""{customer}您好，上周说的推荐朋友的事，有合适的人选吗？

我们最近有个活动，推荐的朋友可以享受：
✅ 免费量房+设计方案
✅ 报价再减5000元
✅ 送全屋保洁

机会难得，您看要不要帮您朋友预约一下？"""
        }
        
        return {
            "scripts": scripts,
            "reward_scheme": {
                "referrer": "全屋美缝（价值2000元）或现金1000元",
                "new_customer": "设计费全免（价值3000-5000元）"
            },
            "follow_up_date": (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
        }
    
    def calculate_roi(self, context: dict) -> dict:
        """计算转介绍ROI"""
        referrals = context.get("referral_count", 10)
        conversion_rate = context.get("conversion_rate", 0.3)
        avg_order = context.get("avg_order_value", 150000)
        reward_cost = context.get("reward_cost", 1000)
        
        signed = int(referrals * conversion_rate)
        revenue = signed * avg_order
        cost = referrals * reward_cost
        roi = (revenue - cost) / cost if cost > 0 else 0
        
        return {
            "referrals": referrals,
            "signed": signed,
            "conversion_rate": f"{conversion_rate*100:.0f}%",
            "revenue": revenue,
            "cost": cost,
            "roi": f"{roi:.1f}",
            "conclusion": "转介绍ROI优秀" if roi > 5 else "转介绍ROI良好" if roi > 2 else "需要优化"
        }


class CommunityAssistant:
    """小区深耕助手"""
    
    def generate_content(self, context: dict) -> dict:
        """生成小区专属内容"""
        community = context.get("community_name", "XX小区")
        city = context.get("city", "本地")
        house_type = context.get("house_type", "三室两厅")
        
        contents = [
            {
                "title": f"{city}{community}业主必看！{house_type}这样装修显大20㎡",
                "angle": "空间优化",
                "key_points": ["拆除非承重墙", "开放式厨房", "嵌入式收纳", "浅色主调"]
            },
            {
                "title": f"{community}装修避坑指南｜90%业主都踩过的5个坑",
                "angle": "避坑指南",
                "key_points": ["水电改造", "防水工程", "材料选择", "工期控制", "增项防范"]
            },
            {
                "title": f"{city}{community}实景案例｜{house_type}现代简约风，预算15万",
                "angle": "案例展示",
                "key_points": ["前后对比", "预算明细", "材料品牌", "工期安排"]
            }
        ]
        
        return {
            "community": community,
            "contents": contents,
            "suggested_hashtags": [f"#{community}", f"#{city}装修", "#装修避坑", "#现代简约"],
            "posting_strategy": "每周2-3篇，周二/周四/周六晚8点"
        }
    
    def design_activity(self, context: dict) -> dict:
        """设计小区活动"""
        community = context.get("community_name", "XX小区")
        
        return {
            "activity_name": f"{community}业主装修交流会",
            "activity_type": "工地参观+讲座",
            "time": "周六下午2-5点",
            "location": f"{community}已完工工地",
            "process": [
                "14:00-14:30 签到，领取资料",
                "14:30-15:00 参观完工工地",
                "15:00-16:00 装修避坑讲座",
                "16:00-16:30 设计师一对一咨询",
                "16:30-17:00 现场签约优惠"
            ],
            "promotion": {
                "到场礼": "装修避坑手册+验房工具",
                "签约礼": "设计费5折+主材9折",
                "限时优惠": "当天签约再减5000元"
            },
            "expected_attendance": 20,
            "expected_conversion": 3
        }


class ContentAssistant:
    """内容营销助手"""
    
    def generate_xiaohongshu(self, context: dict) -> dict:
        """生成小红书内容"""
        topic = context.get("topic", "装修")
        style = context.get("style", "避坑")
        city = context.get("local_city", "")
        
        title_templates = {
            "避坑": [
                f"{city}装修必看！这10个坑我替你们踩过了😭",
                f"装修花了30万总结的血泪教训，看完省5万💰",
                f"装修公司不会告诉你的8个秘密，第3个太坑了",
                f"{city}90后夫妻装修实录｜这些坑千万别踩"
            ],
            "案例": [
                f"{city}80㎡老破小逆袭｜改造前后对比太惊艳",
                f"花15万装出25万的效果｜{city}小户型装修秘籍",
                f"{city}{topic}｜邻居看了都想复制的家",
                f"90㎡三室两厅｜{city}现代简约风完工"
            ],
            "干货": [
                f"2024{city}装修报价清单｜这3项至少省30%",
                f"瓷砖怎么选？{city}建材市场跑遍总结的经验",
                f"{city}装修公司怎么选？看这一篇就够了",
                f"装修流程全攻略｜{city}业主必收藏"
            ]
        }
        
        titles = title_templates.get(style, title_templates["避坑"])
        
        return {
            "titles": titles,
            "content_structure": [
                "痛点引入（3行）",
                "问题分析（5行）",
                "解决方案（重点，10行）",
                "案例佐证（3行）",
                "互动引导（2行）"
            ],
            "hashtags": [f"#{city}装修", f"#{topic}", "#装修避坑", "#装修日记"],
            "image_suggestions": [
                "封面：对比图或痛点图",
                "图2-3：问题展示",
                "图4-6：解决方案",
                "图7：案例效果",
                "图8：互动引导"
            ],
            "best_posting_time": "周二/周四/周六 晚8-9点"
        }
    
    def generate_douyin_script(self, context: dict) -> dict:
        """生成抖音脚本"""
        topic = context.get("topic", "装修避坑")
        
        return {
            "duration": "45-60秒",
            "script": {
                "0-3秒": "钩子：你家装修踩坑了吗？",
                "3-15秒": "痛点：展示装修常见问题",
                "15-35秒": "解决方案：3个实用技巧",
                "35-45秒": "案例：前后对比",
                "45-60秒": "引导：关注+私信"
            },
            "shooting_tips": [
                "真人出镜，增加信任感",
                "工地实拍，真实感强",
                "字幕放大，方便观看",
                "BGM用热门音乐"
            ],
            "posting_strategy": {
                "frequency": "每日1条",
                "best_times": ["12:00", "18:00", "21:00"],
                "dou_budget": "¥100-300/条"
            }
        }


class PartnershipAssistant:
    """异业联盟助手"""
    
    def design_partnership(self, context: dict) -> dict:
        """设计合作方案"""
        partner_type = context.get("partner_type", "建材商")
        partner_name = context.get("partner_name", "XX品牌")
        
        return {
            "cooperation_name": f"XX装饰 x {partner_name} 联合优惠活动",
            "cooperation_model": "互相带客+联合促销",
            "benefits": {
                "我方": ["获取建材店客流", "降低获客成本", "提升客户价值"],
                "对方": ["获取装修客户", "提升销量", "增强客户粘性"]
            },
            "customer_offer": {
                "基础优惠": f"{partner_name}产品8.5折",
                "联合优惠": "装修+主材套餐立减10000元",
                "增值服务": "免费设计+免费送货"
            },
            "revenue_sharing": {
                "我方带客成交": "对方返点5%",
                "对方带客成交": "我方返点3%",
                "联合活动成本": "双方各承担50%"
            },
            "promotion_plan": [
                "Step1: 制作联合优惠卡",
                "Step2: 门店互相放置宣传资料",
                "Step3: 联合举办周末活动",
                "Step4: 建立专属服务群"
            ]
        }


class ProvenAcquisitionAssistant:
    """主助手类"""
    
    def __init__(self):
        self.referral = ReferralAssistant()
        self.community = CommunityAssistant()
        self.content = ContentAssistant()
        self.partnership = PartnershipAssistant()
    
    def execute(self, action: str, context: dict) -> dict:
        """执行操作"""
        if action == "generate_referral_script":
            return self.referral.generate_script(context)
        elif action == "calculate_referral_roi":
            return self.referral.calculate_roi(context)
        elif action == "generate_community_content":
            return self.community.generate_content(context)
        elif action == "design_community_activity":
            return self.community.design_activity(context)
        elif action == "generate_xiaohongshu_content":
            return self.content.generate_xiaohongshu(context)
        elif action == "generate_douyin_script":
            return self.content.generate_douyin_script(context)
        elif action == "design_partnership":
            return self.partnership.design_partnership(context)
        else:
            return {"error": f"Unknown action: {action}"}


def main():
    try:
        input_data = json.load(sys.stdin)
        action = input_data.get("action", "")
        context = input_data.get("context", {})
        
        if not action:
            print(json.dumps({
                "success": False,
                "error": "Missing action parameter"
            }))
            sys.exit(1)
        
        assistant = ProvenAcquisitionAssistant()
        result = assistant.execute(action, context)
        
        output = {
            "success": True,
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


def format_output(action: str, result: dict) -> str:
    """格式化输出"""
    if "error" in result:
        return f"❌ 错误: {result['error']}"
    
    outputs = []
    
    if action == "generate_referral_script":
        outputs.append("📞 转介绍话术已生成\n")
        outputs.append("【电话版】")
        outputs.append(result["scripts"]["phone"][:200] + "...\n")
        outputs.append("【微信版】")
        outputs.append(result["scripts"]["wechat"][:200] + "...\n")
        outputs.append(f"💰 奖励方案: {result['reward_scheme']['referrer']}")
        outputs.append(f"📅 跟进提醒: {result['follow_up_date']}")
    
    elif action == "generate_community_content":
        outputs.append(f"📍 {result['community']}专属内容已生成\n")
        for i, content in enumerate(result['contents'], 1):
            outputs.append(f"{i}. {content['title']}")
        outputs.append(f"\n🏷️ 建议标签: {' '.join(result['suggested_hashtags'])}")
        outputs.append(f"📅 发布策略: {result['posting_strategy']}")
    
    elif action == "generate_xiaohongshu_content":
        outputs.append("📝 小红书标题建议:\n")
        for i, title in enumerate(result['titles'], 1):
            outputs.append(f"{i}. {title}")
        outputs.append(f"\n⏰ 最佳发布时间: {result['best_posting_time']}")
    
    elif action == "design_partnership":
        outputs.append(f"🤝 {result['cooperation_name']}\n")
        outputs.append(f"模式: {result['cooperation_model']}")
        outputs.append(f"\n客户优惠:")
        for k, v in result['customer_offer'].items():
            outputs.append(f"  • {k}: {v}")
    
    else:
        outputs.append("✅ 执行成功")
        outputs.append(json.dumps(result, ensure_ascii=False, indent=2)[:500])
    
    return "\n".join(outputs)


if __name__ == "__main__":
    main()
