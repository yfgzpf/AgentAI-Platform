#!/usr/bin/env python3
"""
Requirement Interview - 装修需求结构化访谈
"""

import json
import sys
from datetime import datetime


# 标准问卷模板
QUESTIONNAIRE_TEMPLATE = {
    "title": "装修需求调研问卷",
    "sections": [
        {
            "title": "一、基础信息",
            "questions": [
                {"id": "area", "question": "房屋建筑面积", "type": "number", "unit": "㎡", "required": True},
                {"id": "rooms", "question": "户型", "type": "select", "options": ["1室1厅", "2室1厅", "2室2厅", "3室1厅", "3室2厅", "4室2厅", "复式/别墅"], "required": True},
                {"id": "floor", "question": "所在楼层", "type": "number", "required": False},
                {"id": "elevator", "question": "是否有电梯", "type": "boolean", "required": False},
                {"id": "property_type", "question": "房屋类型", "type": "select", "options": ["新房毛坯", "新房精装", "二手房", "旧房翻新"], "required": True},
            ]
        },
        {
            "title": "二、居住需求",
            "questions": [
                {"id": "residents", "question": "居住人数", "type": "number", "required": True},
                {"id": "adults", "question": "成年人数量", "type": "number", "required": True},
                {"id": "children", "question": "儿童数量", "type": "number", "required": False},
                {"id": "children_ages", "question": "儿童年龄", "type": "text", "required": False, "show_if": {"children": ">0"}},
                {"id": "elderly", "question": "老人数量", "type": "number", "required": False},
                {"id": "pets", "question": "是否有宠物", "type": "multiselect", "options": ["无", "猫", "狗", "其他"], "required": False},
                {"id": "special_needs", "question": "特殊需求", "type": "multiselect", "options": ["无", "孕妇", "婴儿", "行动不便", "过敏体质", "居家办公"], "required": False},
            ]
        },
        {
            "title": "三、风格偏好",
            "questions": [
                {"id": "style", "question": "喜欢的装修风格", "type": "select", "options": ["现代简约", "北欧", "新中式", "轻奢", "美式", "日式", "工业风", "地中海", "不确定"], "required": True},
                {"id": "color_preference", "question": "颜色偏好", "type": "multiselect", "options": ["白色系", "灰色系", "原木色", "蓝色系", "绿色系", "暖色系", "深色系", "明亮色系"], "required": False},
                {"id": "material_preference", "question": "材质偏好", "type": "multiselect", "options": ["实木", "板材", "石材", "金属", "玻璃", "布艺", "皮革"], "required": False},
                {"id": "reference_images", "question": "是否有参考图片", "type": "boolean", "required": False},
            ]
        },
        {
            "title": "四、功能需求",
            "questions": [
                {"id": "storage_need", "question": "收纳需求", "type": "select", "options": ["高-物品多", "中-正常", "低-极简"], "required": True},
                {"id": "home_office", "question": "是否需要居家办公", "type": "boolean", "required": False},
                {"id": "cooking_frequency", "question": "做饭频率", "type": "select", "options": ["每天", "经常", "偶尔", "从不"], "required": True},
                {"id": "kitchen_requirements", "question": "厨房功能需求", "type": "multiselect", "options": ["开放式厨房", "中岛台", "双开门冰箱", "洗碗机", "蒸烤箱", "垃圾处理器", "净水器"], "required": False},
                {"id": "bathroom_requirements", "question": "卫生间需求", "type": "multiselect", "options": ["干湿分离", "浴缸", "智能马桶", "双台盆", "淋浴房", "地暖"], "required": False},
                {"id": "entertainment", "question": "娱乐需求", "type": "multiselect", "options": ["电视", "投影", "游戏区", "阅读角", "健身区", "儿童活动区"], "required": False},
            ]
        },
        {
            "title": "五、预算与时间",
            "questions": [
                {"id": "total_budget", "question": "装修总预算", "type": "select", "options": ["10万以下", "10-15万", "15-20万", "20-30万", "30-50万", "50万以上"], "required": True},
                {"id": "priority_areas", "question": "重点投入区域", "type": "multiselect", "options": ["客厅", "主卧", "厨房", "卫生间", "儿童房", "书房"], "required": False},
                {"id": "move_in_date", "question": "计划入住时间", "type": "date", "required": False},
                {"id": "duration_flexibility", "question": "工期要求", "type": "select", "options": ["越快越好", "3个月内", "半年内", "不着急"], "required": False},
            ]
        }
    ]
}


def generate_questionnaire() -> dict:
    """生成问卷"""
    return {
        "success": True,
        "output": """📋 装修需求调研问卷

我已为您准备好专业的装修需求调研问卷，包含5个维度、30+个问题：

**一、基础信息**
- 房屋面积、户型、楼层
- 是否有电梯
- 新房/二手房/旧房翻新

**二、居住需求**
- 居住人数、年龄结构
- 是否有儿童/老人/宠物
- 特殊需求（孕妇、居家办公等）

**三、风格偏好**
- 装修风格选择
- 颜色、材质偏好
- 参考图片收集

**四、功能需求**
- 收纳需求程度
- 厨房功能（开放式、中岛台等）
- 卫生间功能（干湿分离、浴缸等）
- 娱乐、办公需求

**五、预算与时间**
- 总预算范围
- 重点投入区域
- 计划入住时间

💡 **使用方式：**
1. 复制以上问题，通过微信/问卷星发给客户
2. 客户填写后，将答案发给我分析
3. 我将生成结构化的需求文档

需要我直接开始访谈吗？或者您提供客户的初步信息，我帮您分析需求重点。""",
        "data": {
            "questionnaire": QUESTIONNAIRE_TEMPLATE,
            "question_count": sum(len(s["questions"]) for s in QUESTIONNAIRE_TEMPLATE["sections"])
        }
    }


def analyze_requirements(requirement_text: str) -> dict:
    """分析需求文本，提取结构化信息"""
    
    # 简单的关键词提取
    analysis = {
        "extracted_info": {},
        "key_points": [],
        "recommendations": [],
        "risks": []
    }
    
    # 提取面积
    import re
    area_match = re.search(r'(\d+)\s*平', requirement_text)
    if area_match:
        analysis["extracted_info"]["area"] = int(area_match.group(1))
    
    # 提取户型
    room_patterns = [r'(\d+)\s*室', r'(\d+)\s*房']
    for pattern in room_patterns:
        match = re.search(pattern, requirement_text)
        if match:
            analysis["extracted_info"]["rooms"] = match.group(1) + "室"
            break
    
    # 风格识别
    styles = ["现代简约", "北欧", "中式", "轻奢", "美式", "日式", "工业风"]
    for style in styles:
        if style in requirement_text:
            analysis["extracted_info"]["style"] = style
            break
    
    # 预算识别
    budget_patterns = [
        (r'(\d+)\s*万', lambda x: int(x) * 10000),
        (r'(\d+)\s*千', lambda x: int(x) * 1000),
    ]
    for pattern, converter in budget_patterns:
        match = re.search(pattern, requirement_text)
        if match:
            analysis["extracted_info"]["budget"] = converter(match.group(1))
            break
    
    # 关键需求点
    if "收纳" in requirement_text or "储物" in requirement_text:
        analysis["key_points"].append("高收纳需求 - 建议多做定制柜")
    
    if "小孩" in requirement_text or "儿童" in requirement_text:
        analysis["key_points"].append("有儿童 - 注意环保、安全、成长性设计")
    
    if "老人" in requirement_text:
        analysis["key_points"].append("有老人 - 注意无障碍、防滑、扶手设计")
    
    if "办公" in requirement_text or "工作" in requirement_text:
        analysis["key_points"].append("居家办公 - 需要独立办公区")
    
    if "开放式" in requirement_text:
        analysis["key_points"].append("开放式设计 - 注意油烟、噪音问题")
    
    # 建议
    if "area" in analysis["extracted_info"]:
        area = analysis["extracted_info"]["area"]
        if area < 60:
            analysis["recommendations"].append("小户型建议：轻装修重装饰，多用多功能家具")
        elif area > 120:
            analysis["recommendations"].append("大户型建议：注意空间分区，避免过于空旷")
    
    # 风险提示
    if "budget" in analysis["extracted_info"] and "area" in analysis["extracted_info"]:
        per_sqm = analysis["extracted_info"]["budget"] / analysis["extracted_info"]["area"]
        if per_sqm < 1000:
            analysis["risks"].append("预算偏低（<1000元/㎡），可能难以保证质量，建议调整预期或分期装修")
    
    return analysis


def generate_requirement_document(analysis: dict) -> str:
    """生成需求文档"""
    doc = """# 装修需求分析文档

## 一、客户基本信息
"""
    
    for key, value in analysis.get("extracted_info", {}).items():
        doc += f"- **{key}**: {value}\n"
    
    doc += """
## 二、需求重点
"""
    
    for point in analysis.get("key_points", []):
        doc += f"- {point}\n"
    
    if not analysis.get("key_points"):
        doc += "- 暂无特殊需求点\n"
    
    doc += """
## 三、设计建议
"""
    
    for rec in analysis.get("recommendations", []):
        doc += f"- {rec}\n"
    
    if not analysis.get("recommendations"):
        doc += "- 根据进一步沟通提供详细建议\n"
    
    doc += """
## 四、风险提示
"""
    
    for risk in analysis.get("risks", []):
        doc += f"- ⚠️ {risk}\n"
    
    if not analysis.get("risks"):
        doc += "- 暂无显著风险\n"
    
    doc += """
## 五、下一步行动
- [ ] 现场量房
- [ ] 深化需求访谈
- [ ] 初步方案设计
- [ ] 预算细化
"""
    
    return doc


def main():
    try:
        input_data = json.load(sys.stdin)
        
        action = input_data.get("action", "questionnaire")
        
        if action == "questionnaire":
            # 生成问卷
            result = generate_questionnaire()
            
        elif action == "analyze":
            # 分析需求
            requirement_text = input_data.get("requirement_text", "")
            if not requirement_text:
                print(json.dumps({
                    "success": False,
                    "error": "请提供需求文本"
                }))
                sys.exit(1)
            
            analysis = analyze_requirements(requirement_text)
            doc = generate_requirement_document(analysis)
            
            result = {
                "success": True,
                "output": f"""📊 需求分析结果

{doc}

💡 **分析完成！**
基于客户提供的信息，我已提取关键需求点并生成需求文档。

建议下一步：
1. 与客户确认分析结果
2. 安排现场量房
3. 根据量房数据细化方案
""",
                "data": {
                    "analysis": analysis,
                    "document": doc
                }
            }
            
        else:
            result = {
                "success": False,
                "error": f"未知 action: {action}"
            }
        
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
