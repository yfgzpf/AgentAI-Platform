#!/usr/bin/env python3
"""
Construction Supervisor Skill
装修施工监理助手
"""

import json
import sys
import re
from typing import Dict, List, Any


# 施工阶段定义
CONSTRUCTION_STAGES = {
    "拆除改造": {
        "duration": "2-3天",
        "key_points": ["拆除范围确认", "承重墙保护", "垃圾清运", "成品保护"],
        "risks": ["误拆承重墙", "损坏公共设施", "噪音投诉"],
        "next_stage": "水电改造"
    },
    "水电改造": {
        "duration": "5-7天",
        "key_points": ["水管打压测试", "电路绝缘测试", "强弱电分离", "留存走向图"],
        "inspection": [
            {"item": "水管打压", "method": "0.8-1.0MPa保压30分钟", "standard": "压降≤0.05MPa"},
            {"item": "电路绝缘", "method": "摇表测试", "standard": "≥0.5MΩ"},
            {"item": "强弱电间距", "method": "尺量", "standard": "≥50cm"},
            {"item": "线管固定", "method": "目测", "standard": "管卡间距≤80cm"},
        ],
        "risks": ["漏水", "短路", "插座位置错误", "未留检修口"],
        "next_stage": "泥瓦工程"
    },
    "泥瓦工程": {
        "duration": "10-15天",
        "key_points": ["防水处理", "闭水试验", "瓷砖铺贴", "勾缝清理"],
        "inspection": [
            {"item": "防水高度", "method": "尺量", "standard": "墙面≥1.8m，地面全做"},
            {"item": "闭水试验", "method": "48小时蓄水", "standard": "无渗漏"},
            {"item": "瓷砖空鼓", "method": "空鼓锤敲击", "standard": "空鼓率≤5%"},
            {"item": "平整度", "method": "2m靠尺", "standard": "误差≤3mm"},
            {"item": "阴阳角", "method": "角尺", "standard": "90度±3度"},
        ],
        "risks": ["漏水", "空鼓", "平整度差", "色差"],
        "next_stage": "木工工程"
    },
    "木工工程": {
        "duration": "7-10天",
        "key_points": ["吊顶龙骨", "石膏板安装", "柜子制作", "五金安装"],
        "inspection": [
            {"item": "龙骨间距", "method": "尺量", "standard": "≤40cm"},
            {"item": "吊顶牢固", "method": "晃动检查", "standard": "无松动"},
            {"item": "柜子尺寸", "method": "尺量", "standard": "误差≤5mm"},
            {"item": "五金顺畅", "method": "试用", "standard": "开关顺畅"},
        ],
        "risks": ["吊顶开裂", "柜子变形", "五金松动"],
        "next_stage": "油漆工程"
    },
    "油漆工程": {
        "duration": "10-15天",
        "key_points": ["基层处理", "腻子打磨", "底漆涂刷", "面漆涂刷"],
        "inspection": [
            {"item": "墙面平整", "method": "2m靠尺+灯光", "standard": "误差≤3mm"},
            {"item": "阴阳角", "method": "目测", "standard": "平直无崩边"},
            {"item": "涂刷均匀", "method": "目测", "standard": "无流坠无刷痕"},
            {"item": "颜色一致", "method": "自然光下看", "standard": "无色差"},
        ],
        "risks": ["开裂", "起皮", "发霉", "色差"],
        "next_stage": "安装收尾"
    },
    "安装收尾": {
        "duration": "5-7天",
        "key_points": ["门窗安装", "卫浴安装", "灯具安装", "地板安装", "开关面板"],
        "inspection": [
            {"item": "门窗开关", "method": "试用", "standard": "顺畅，密封好"},
            {"item": "卫浴水平", "method": "水平尺", "standard": "水平度≤2mm"},
            {"item": "无渗漏", "method": "试水", "standard": "无渗漏"},
            {"item": "灯具功能", "method": "通电测试", "standard": "全部正常"},
            {"item": "地板踩踏", "method": "走动", "standard": "无异响"},
        ],
        "risks": ["门窗漏风", "卫浴漏水", "灯具不亮", "地板异响"],
        "next_stage": "完工验收"
    }
}


# 质量问题诊断
QUALITY_ISSUES = {
    "墙面开裂": {
        "symptoms": ["裂缝", "开裂", "裂纹"],
        "causes": ["基层处理不当", "结构沉降", "温度变化", "材料收缩"],
        "solutions": ["铲除裂缝处", "加网格布", "重新批腻子", "重新刷漆"],
        "severity": "中"
    },
    "墙面起皮": {
        "symptoms": ["起皮", "脱落", "掉皮"],
        "causes": ["潮湿", "底漆不配套", "基层粉化"],
        "solutions": ["找出潮源", "铲除起皮处", "重新做防水", "重新涂刷"],
        "severity": "高"
    },
    "瓷砖空鼓": {
        "symptoms": ["空鼓", "空响", "松动"],
        "causes": ["铺贴不当", "基层问题", "粘结剂问题"],
        "solutions": ["标记空鼓处", "重新铺贴", "使用瓷砖胶"],
        "severity": "中"
    },
    "漏水": {
        "symptoms": ["漏水", "渗水", "滴水"],
        "causes": ["接头松动", "管材破裂", "防水失效"],
        "solutions": ["找到漏点", "关闭总阀", "重新连接", "重做防水"],
        "severity": "高"
    },
    "电路跳闸": {
        "symptoms": ["跳闸", "断电", "没电"],
        "causes": ["短路", "过载", "漏电", "空开故障"],
        "solutions": ["检查线路", "减少负载", "更换空开", "找电工"],
        "severity": "高"
    }
}


def detect_stage(message: str) -> str:
    """检测当前施工阶段。"""
    stage_keywords = {
        "拆除改造": ["拆除", "砸墙", "清运"],
        "水电改造": ["水电", "水管", "电线", "电路", "防水"],
        "泥瓦工程": ["瓦工", "瓷砖", "铺砖", "砌墙", "抹灰"],
        "木工工程": ["木工", "吊顶", "柜子", "打柜", "石膏板"],
        "油漆工程": ["油漆", "涂料", "刷漆", "腻子", "乳胶漆"],
        "安装收尾": ["安装", "卫浴", "灯具", "地板", "门窗"]
    }
    
    msg = message.lower()
    for stage, keywords in stage_keywords.items():
        if any(kw in msg for kw in keywords):
            return stage
    
    return "未知"


def diagnose_issue(message: str) -> Dict:
    """诊断质量问题。"""
    for issue_name, issue_info in QUALITY_ISSUES.items():
        if any(symptom in message for symptom in issue_info["symptoms"]):
            return {
                "问题": issue_name,
                "可能原因": issue_info["causes"],
                "解决方案": issue_info["solutions"],
                "严重程度": issue_info["severity"]
            }
    
    return None


def get_stage_guide(stage: str) -> str:
    """获取阶段指导。"""
    if stage not in CONSTRUCTION_STAGES:
        return "未找到该阶段的指导信息"
    
    info = CONSTRUCTION_STAGES[stage]
    
    lines = [
        f"📋 {stage} 施工指导",
        f"⏱️ 标准工期: {info['duration']}",
        "",
        "🔑 关键要点:",
    ]
    
    for point in info['key_points']:
        lines.append(f"   • {point}")
    
    if 'inspection' in info:
        lines.extend(["", "✅ 验收标准:"])
        for item in info['inspection']:
            lines.append(f"   • {item['item']}: {item['method']} → {item['standard']}")
    
    lines.extend(["", "⚠️ 风险提示:"])
    for risk in info['risks']:
        lines.append(f"   • {risk}")
    
    if 'next_stage' in info:
        lines.extend(["", f"➡️ 下一阶段: {info['next_stage']}"])
    
    return '\n'.join(lines)


def calculate_progress(stage: str) -> str:
    """计算装修进度。"""
    stages = list(CONSTRUCTION_STAGES.keys())
    if stage not in stages:
        return "未知"
    
    idx = stages.index(stage)
    progress = (idx + 0.5) / len(stages) * 100
    return f"{progress:.0f}%"


def main():
    """Main entry point."""
    try:
        input_data = json.load(sys.stdin)
        
        action = input_data.get('action', 'guide')
        message = input_data.get('message', '')
        stage = input_data.get('stage', '')
        
        # 自动检测阶段
        if not stage and message:
            stage = detect_stage(message)
        
        if action == 'guide':
            # 提供施工指导
            if stage and stage in CONSTRUCTION_STAGES:
                output = get_stage_guide(stage)
                data = {
                    "stage": stage,
                    "progress": calculate_progress(stage),
                    "guide": CONSTRUCTION_STAGES[stage]
                }
            else:
                # 提供全流程概览
                lines = ["🏠 装修全流程概览\n"]
                for i, (s, info) in enumerate(CONSTRUCTION_STAGES.items(), 1):
                    lines.append(f"{i}. {s} ({info['duration']})")
                lines.append(f"\n📊 总工期: 40-55天")
                output = '\n'.join(lines)
                data = {"stages": list(CONSTRUCTION_STAGES.keys())}
        
        elif action == 'diagnose':
            # 质量问题诊断
            issue = diagnose_issue(message)
            if issue:
                lines = [
                    f"🔍 问题诊断: {issue['问题']}",
                    f"⚠️ 严重程度: {issue['严重程度']}",
                    "",
                    "可能原因:",
                ]
                for cause in issue['可能原因']:
                    lines.append(f"   • {cause}")
                
                lines.extend(["", "解决方案:"])
                for solution in issue['解决方案']:
                    lines.append(f"   • {solution}")
                
                output = '\n'.join(lines)
                data = issue
            else:
                output = "未识别出具体问题，请详细描述:\n- 问题现象\n- 发生位置\n- 发生时间"
                data = None
        
        elif action == 'progress':
            # 进度跟踪
            if stage:
                progress = calculate_progress(stage)
                info = CONSTRUCTION_STAGES.get(stage, {})
                
                lines = [
                    f"📊 当前阶段: {stage}",
                    f"完成进度: {progress}",
                    f"标准工期: {info.get('duration', '未知')}",
                    "",
                    "下一步工作:",
                ]
                for point in info.get('key_points', [])[:3]:
                    lines.append(f"   • {point}")
                
                if 'next_stage' in info:
                    lines.extend(["", f"➡️ 接下来: {info['next_stage']}"])
                
                output = '\n'.join(lines)
                data = {"stage": stage, "progress": progress}
            else:
                output = "请提供当前施工阶段，例如: 水电改造、泥瓦工程"
                data = None
        
        else:
            output = f"未知 action: {action}"
            data = None
        
        print(json.dumps({
            'success': True,
            'output': output,
            'data': data
        }))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))


if __name__ == '__main__':
    main()
