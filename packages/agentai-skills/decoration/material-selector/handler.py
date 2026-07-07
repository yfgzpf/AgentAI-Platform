#!/usr/bin/env python3
"""
Material Selector Skill
智能装修材料选型助手
"""

import json
import sys
import re
from typing import Dict, List, Any


# 材料数据库
MATERIAL_DB = {
    "tiles": {
        "抛光砖": {
            "适用场景": ["客厅", "卧室"],
            "价格区间": "80-200元/㎡",
            "品牌推荐": ["马可波罗", "东鹏", "冠珠"],
            "特点": ["耐磨", "易打理", "光亮"],
            "环保": "E0级"
        },
        "釉面砖": {
            "适用场景": ["厨房", "卫生间"],
            "价格区间": "60-150元/㎡",
            "品牌推荐": ["蒙娜丽莎", "诺贝尔", "斯米克"],
            "特点": ["防滑", "防污", "花色多"],
            "环保": "E0级"
        },
        "仿古砖": {
            "适用场景": ["阳台", "复古风格"],
            "价格区间": "100-300元/㎡",
            "品牌推荐": ["金意陶", "楼兰", "马可波罗"],
            "特点": ["复古", "防滑", "质感好"],
            "环保": "E0级"
        },
        "木纹砖": {
            "适用场景": ["卧室", "北欧风格"],
            "价格区间": "90-250元/㎡",
            "品牌推荐": ["马可波罗", "冠珠", "蒙娜丽莎"],
            "特点": ["仿木纹理", "防水", "耐磨"],
            "环保": "E0级"
        }
    },
    "flooring": {
        "实木地板": {
            "适用场景": ["卧室", "书房"],
            "价格区间": "300-800元/㎡",
            "品牌推荐": ["大自然", "圣象", "安信"],
            "特点": ["环保", "脚感好", "天然纹理"],
            "环保": "E0级"
        },
        "复合地板": {
            "适用场景": ["客厅", "卧室"],
            "价格区间": "100-300元/㎡",
            "品牌推荐": ["德尔", "菲林格尔", "生活家"],
            "特点": ["性价比高", "稳定", "易安装"],
            "环保": "E1级"
        },
        "强化地板": {
            "适用场景": ["客厅", "出租房"],
            "价格区间": "80-200元/㎡",
            "品牌推荐": ["圣象", "世友", "菲林格尔"],
            "特点": ["超耐磨", "易打理", "便宜"],
            "环保": "E1级"
        },
        "SPC石塑": {
            "适用场景": ["厨房", "阳台", "地下室"],
            "价格区间": "60-150元/㎡",
            "品牌推荐": ["贝尔", "丽车", "绿可"],
            "特点": ["零甲醛", "防水", "防火"],
            "环保": "E0级"
        }
    },
    "paint": {
        "乳胶漆": {
            "适用场景": ["全屋墙面"],
            "价格区间": "200-600元/桶(18L)",
            "品牌推荐": ["立邦", "多乐士", "三棵树"],
            "特点": ["性价比高", "颜色多", "易施工"],
            "环保": "国标"
        },
        "儿童漆": {
            "适用场景": ["儿童房", "卧室"],
            "价格区间": "800-1500元/桶",
            "品牌推荐": ["立邦儿童漆", "芬琳", "都芳"],
            "特点": ["零VOC", "抗污", "可擦洗"],
            "环保": "法国A+"
        },
        "艺术漆": {
            "适用场景": ["背景墙", "特色墙面"],
            "价格区间": "150-500元/㎡",
            "品牌推荐": ["威罗", "瓦帕茵特", "立邦艺术漆"],
            "特点": ["质感丰富", "个性化", "高端"],
            "环保": "进口标准"
        },
        "硅藻泥": {
            "适用场景": ["卧室", "客厅"],
            "价格区间": "200-400元/㎡",
            "品牌推荐": ["兰舍", "大津", "绿森林"],
            "特点": ["天然环保", "调湿", "除甲醛"],
            "环保": "天然材料"
        }
    },
    "bathroom": {
        "马桶": {
            "价格区间": "1000-5000元",
            "品牌推荐": ["TOTO", "科勒", "箭牌", "九牧"],
            "特点": ["虹吸式", "节水", "静音"]
        },
        "浴室柜": {
            "价格区间": "2000-8000元",
            "品牌推荐": ["九牧", "恒洁", "法恩莎", "箭牌"],
            "特点": ["防潮", "收纳", "美观"]
        },
        "花洒": {
            "价格区间": "500-3000元",
            "品牌推荐": ["汉斯格雅", "摩恩", "九牧", "科勒"],
            "特点": ["恒温", "增压", "多模式"]
        },
        "龙头": {
            "价格区间": "300-2000元",
            "品牌推荐": ["科勒", "摩恩", "TOTO", "九牧"],
            "特点": ["铜芯", "陶瓷阀芯", "节水"]
        }
    }
}


STYLE_MATCH = {
    "现代简约": {"colors": ["灰色", "白色", "米色"], "materials": ["抛光砖", "强化地板", "乳胶漆"]},
    "北欧风": {"colors": ["原木色", "浅灰", "白色"], "materials": ["木纹砖", "实木地板", "乳胶漆"]},
    "中式": {"colors": ["红木色", "暖黄", "深棕"], "materials": ["实木地板", "仿古砖", "硅藻泥"]},
    "轻奢": {"colors": ["金色", "大理石纹", "深蓝"], "materials": ["大理石砖", "复合地板", "艺术漆"]},
    "工业风": {"colors": ["水泥灰", "黑色", "金属色"], "materials": ["水泥砖", "SPC石塑", "艺术漆"]}
}


def parse_budget(budget_str: str) -> tuple:
    """解析预算字符串。"""
    # 匹配 "10万", "100000", "10-15万" 等格式
    numbers = re.findall(r'(\d+(?:\.\d+)?)\s*(万)?', budget_str)
    if numbers:
        amount = float(numbers[0][0])
        if numbers[0][1] or '万' in budget_str:
            amount *= 10000
        return amount, classify_budget(amount)
    return 0, "unknown"


def classify_budget(amount: float) -> str:
    """预算分级。"""
    if amount < 50000:
        return "经济型"
    elif amount < 150000:
        return "舒适型"
    elif amount < 300000:
        return "品质型"
    else:
        return "豪华型"


def detect_style(message: str) -> str:
    """检测装修风格。"""
    msg = message.lower()
    for style in STYLE_MATCH:
        if style.lower() in msg or any(kw in msg for kw in STYLE_MATCH[style]["colors"]):
            return style
    return "现代简约"  # 默认


def detect_space(message: str) -> List[str]:
    """检测空间类型。"""
    spaces = []
    space_keywords = {
        "客厅": ["客厅", "客廳", "living"],
        "卧室": ["卧室", "主卧", "次卧", "bedroom"],
        "厨房": ["厨房", "厨", "kitchen"],
        "卫生间": ["卫生间", "厕所", "浴室", "bathroom"],
        "阳台": ["阳台", "露台", "balcony"],
        "书房": ["书房", "study"]
    }
    
    for space, keywords in space_keywords.items():
        if any(kw in message for kw in keywords):
            spaces.append(space)
    
    return spaces if spaces else ["全屋"]


def detect_eco_priority(message: str) -> int:
    """检测环保优先级 (0-10)。"""
    eco_keywords = ["环保", "零甲醛", "E0", "儿童", "孕妇", "老人", "健康"]
    count = sum(1 for kw in eco_keywords if kw in message)
    return min(count * 2 + 5, 10)  # 基础5分，每匹配一个加2分


def recommend_materials(budget: float, style: str, spaces: List[str], eco_priority: int) -> Dict:
    """推荐材料组合。"""
    recommendations = []
    total_cost = 0
    
    # 根据预算确定材料档次
    if budget < 50000:
        price_level = "low"
    elif budget < 150000:
        price_level = "mid"
    else:
        price_level = "high"
    
    # 地面材料推荐
    for space in spaces:
        if space in ["客厅", "卧室"]:
            if style == "北欧风":
                mat = MATERIAL_DB["flooring"]["实木地板"] if price_level == "high" else MATERIAL_DB["flooring"]["复合地板"]
            else:
                mat = MATERIAL_DB["tiles"]["抛光砖"] if price_level != "low" else MATERIAL_DB["tiles"]["釉面砖"]
            
            recommendations.append({
                "空间": space,
                "类别": "地面",
                "材料": "实木地板" if "实木" in str(mat) else "抛光砖",
                "品牌推荐": mat["品牌推荐"][:2],
                "价格区间": mat["价格区间"],
                "理由": f"适合{style}，{'环保' if eco_priority > 7 else '性价比高'}"
            })
    
    # 墙面材料
    if eco_priority > 8:
        paint = MATERIAL_DB["paint"]["儿童漆"]
    elif eco_priority > 5:
        paint = MATERIAL_DB["paint"]["硅藻泥"]
    else:
        paint = MATERIAL_DB["paint"]["乳胶漆"]
    
    recommendations.append({
        "空间": "全屋墙面",
        "类别": "涂料",
        "材料": "儿童漆" if eco_priority > 8 else ("硅藻泥" if eco_priority > 5 else "乳胶漆"),
        "品牌推荐": paint["品牌推荐"][:2],
        "价格区间": paint["价格区间"],
        "理由": f"{'零VOC，适合儿童/孕妇' if eco_priority > 8 else ('天然环保，调湿除醛' if eco_priority > 5 else '性价比高，颜色丰富')}"
    })
    
    # 卫浴（如果有卫生间）
    if "卫生间" in spaces:
        bathroom_items = []
        for item, info in MATERIAL_DB["bathroom"].items():
            bathroom_items.append({
                "品类": item,
                "品牌推荐": info["品牌推荐"][:2],
                "价格区间": info["价格区间"]
            })
        
        recommendations.append({
            "空间": "卫生间",
            "类别": "卫浴",
            "材料": "全套卫浴",
            "明细": bathroom_items,
            "理由": "一线品牌，质量可靠"
        })
    
    return {
        "recommendations": recommendations,
        "预算分级": classify_budget(budget),
        "风格匹配": style,
        "环保优先级": f"{eco_priority}/10",
        "建议": generate_tips(budget, style, eco_priority)
    }


def generate_tips(budget: float, style: str, eco_priority: int) -> List[str]:
    """生成选购建议。"""
    tips = []
    
    if budget < 50000:
        tips.append("💰 预算有限，建议重点投入在厨卫和卧室，客厅可适当简化")
    elif budget > 200000:
        tips.append("✨ 预算充足，可以考虑进口品牌和高端定制")
    
    if eco_priority > 7:
        tips.append("🌿 环保优先：涂料选儿童漆或硅藻泥，地板选实木或SPC石塑")
    
    if style == "北欧风":
        tips.append("🏠 北欧风建议：浅色地板+白色墙面+原木家具")
    elif style == "现代简约":
        tips.append("🏠 现代简约建议：灰色系瓷砖+简洁线条+少而精的装饰")
    
    tips.append("🛒 采购建议：瓷砖地板建议线下看样，涂料卫浴可以线上比价")
    tips.append("⚠️ 注意事项：签订正规合同，明确材料品牌和型号，避免以次充好")
    
    return tips


def main():
    """Main entry point."""
    try:
        input_data = json.load(sys.stdin)
        
        # 获取参数
        message = input_data.get('message', '')
        budget_str = input_data.get('budget', '')
        style_input = input_data.get('style', '')
        spaces_input = input_data.get('spaces', [])
        
        # 解析参数
        budget, budget_level = parse_budget(budget_str) if budget_str else (100000, "舒适型")
        style = style_input if style_input else detect_style(message)
        spaces = spaces_input if spaces_input else detect_space(message)
        eco_priority = detect_eco_priority(message)
        
        # 生成推荐
        result = recommend_materials(budget, style, spaces, eco_priority)
        
        # 格式化输出
        output_lines = [
            f"🎯 材料选型方案 ({style})",
            f"💰 预算分级: {result['预算分级']} (约{budget/10000:.1f}万)",
            f"🌿 环保优先级: {result['环保优先级']}",
            "",
            "📋 推荐材料清单:",
        ]
        
        for i, rec in enumerate(result['recommendations'], 1):
            output_lines.append(f"\n{i}. {rec['空间']} - {rec['类别']}")
            if '明细' in rec:
                for item in rec['明细']:
                    output_lines.append(f"   • {item['品类']}: {', '.join(item['品牌推荐'])} ({item['价格区间']})")
            else:
                output_lines.append(f"   材料: {rec['材料']}")
                output_lines.append(f"   品牌: {', '.join(rec['品牌推荐'])}")
                output_lines.append(f"   价格: {rec['价格区间']}")
                output_lines.append(f"   理由: {rec['理由']}")
        
        output_lines.extend([
            "",
            "💡 选购建议:",
        ])
        for tip in result['建议']:
            output_lines.append(f"   {tip}")
        
        print(json.dumps({
            'success': True,
            'output': '\n'.join(output_lines),
            'data': result
        }))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))


if __name__ == '__main__':
    main()
