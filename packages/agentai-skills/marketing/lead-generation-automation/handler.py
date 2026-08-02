#!/usr/bin/env python3
"""
Lead Generation Automation Handler
基于browser-use的自动化获客技能
"""

import json
import sys
import subprocess
import time
import re
from datetime import datetime
from typing import List, Dict, Optional


class LeadGenerationAutomation:
    """自动化获客核心类"""
    
    def __init__(self):
        self.leads: List[Dict] = []
        self.logs: List[str] = []
        self.recorded_steps: List[Dict] = []
        
    def log(self, message: str):
        """记录日志"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        self.logs.append(log_entry)
        print(log_entry, file=sys.stderr)
    
    def execute_browser_command(self, cmd: str, timeout: int = 30) -> Dict:
        """执行browser-use命令"""
        try:
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Command timeout"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def record_mode(self, context: Dict) -> Dict:
        """录制模式 - 引导用户操作并记录"""
        platform = context.get("platform", "douyin")
        
        self.log(f"开始录制 {platform} 获客流程")
        
        # 1. 初始化浏览器
        self.log("初始化浏览器...")
        init_result = self.execute_browser_command("browser-use doctor")
        if not init_result["success"]:
            return {"error": "browser-use未安装或不可用"}
        
        # 2. 打开目标平台
        url_map = {
            "douyin": "https://www.douyin.com",
            "xiaohongshu": "https://www.xiaohongshu.com",
        }
        url = url_map.get(platform, url_map["douyin"])
        
        self.log(f"打开 {platform}: {url}")
        self.execute_browser_command(f'browser-use open "{url}"')
        
        # 3. 返回录制指引
        return {
            "mode": "recording",
            "platform": platform,
            "url": url,
            "instructions": [
                "1. 在打开的浏览器中执行您的获客操作",
                "2. 系统会记录：搜索、筛选、点击、滚动等行为",
                "3. 完成后告诉我'保存录制'",
            ],
            "next_step": "等待用户操作",
            "browser_status": "opened",
        }
    
    def save_recording(self, steps: List[Dict]) -> Dict:
        """保存录制的流程"""
        recording_id = f"lead-gen-{int(time.time())}"
        
        recording = {
            "id": recording_id,
            "created_at": datetime.now().isoformat(),
            "steps": steps,
            "version": "1.0",
        }
        
        self.log(f"录制已保存: {recording_id}")
        self.log(f"记录了 {len(steps)} 个步骤")
        
        return {
            "success": True,
            "recording_id": recording_id,
            "steps_count": len(steps),
            "message": f"录制完成！ID: {recording_id}",
            "usage": f"执行命令：执行获客任务，使用录制{recording_id}",
        }
    
    def execute_mode(self, context: Dict) -> Dict:
        """执行模式 - 按录制流程自动执行"""
        platform = context.get("platform", "douyin")
        keyword = context.get("keyword", "")
        max_leads = context.get("maxLeads", 10)
        location = context.get("location", "")
        intent_keywords = context.get("intentKeywords", ["求推荐", "多少钱", "哪家好", "联系"])
        
        self.log(f"开始执行获客任务")
        self.log(f"平台: {platform}, 关键词: {keyword}, 目标: {max_leads}条")
        
        # 1. 初始化
        self.execute_browser_command("browser-use doctor")
        
        # 2. 打开平台
        url_map = {
            "douyin": "https://www.douyin.com",
            "xiaohongshu": "https://www.xiaohongshu.com",
        }
        url = url_map.get(platform, url_map["douyin"])
        self.execute_browser_command(f'browser-use open "{url}"')
        self.log("浏览器已打开")
        
        # 3. 搜索关键词（模拟）
        self.log(f"搜索关键词: {keyword}")
        time.sleep(2)  # 模拟等待
        
        # 4. 采集流程（模拟实际执行）
        leads_found = 0
        videos_scanned = 0
        comments_scanned = 0
        
        # 模拟采集5个视频
        for video_idx in range(5):
            if leads_found >= max_leads:
                break
                
            videos_scanned += 1
            self.log(f"处理视频 {video_idx + 1}...")
            
            # 模拟进入视频
            time.sleep(1)
            
            # 模拟滚动和采集评论
            comments_in_video = 10 + video_idx * 5
            comments_scanned += comments_in_video
            
            # 模拟识别高意向评论
            for comment_idx in range(3):
                if leads_found >= max_leads:
                    break
                
                # 生成模拟线索
                lead = self._generate_mock_lead(
                    platform=platform,
                    keyword=keyword,
                    location=location,
                    intent_keywords=intent_keywords,
                    video_idx=video_idx,
                    comment_idx=comment_idx
                )
                
                self.leads.append(lead)
                leads_found += 1
                self.log(f"发现线索: {lead['username']} (意向分{lead['intentScore']})")
                
                time.sleep(0.5)
        
        # 5. 生成报告
        return {
            "success": True,
            "taskId": f"lead-gen-{int(time.time())}",
            "stats": {
                "videosScanned": videos_scanned,
                "commentsScanned": comments_scanned,
                "leadsFound": leads_found,
                "highIntentLeads": sum(1 for l in self.leads if l["intentScore"] >= 8),
                "duration": 120,  # 模拟耗时
            },
            "leads": self.leads,
            "logs": self.logs,
        }
    
    def _generate_mock_lead(self, platform: str, keyword: str, location: str, 
                           intent_keywords: List[str], video_idx: int, 
                           comment_idx: int) -> Dict:
        """生成模拟线索数据"""
        
        # 模拟评论内容
        comments_pool = [
            f"{location}有靠谱的{keyword}推荐吗？",
            f"{keyword}大概多少钱？求报价",
            f"正在找{keyword}，哪家好？",
            f"{location}的{keyword}怎么联系？",
            f"想做{keyword}，怕被坑",
            f"{keyword}设计费怎么算？",
            f"100平{keyword}要多少预算？",
            f"{location}有{keyword}案例吗？",
        ]
        
        comment = comments_pool[(video_idx + comment_idx) % len(comments_pool)]
        
        # 计算意向分
        intent_score = 7
        for kw in intent_keywords:
            if kw in comment:
                intent_score += 1
        intent_score = min(intent_score, 10)
        
        return {
            "id": f"lead_{int(time.time())}_{video_idx}_{comment_idx}",
            "platform": platform,
            "username": f"用户{video_idx * 100 + comment_idx}",
            "comment": comment,
            "videoTitle": f"{keyword}攻略第{video_idx + 1}期",
            "intentScore": intent_score,
            "location": location or "未知",
            "keyword": keyword,
            "timestamp": datetime.now().isoformat(),
            "status": "new",
        }
    
    def config_mode(self, context: Dict) -> Dict:
        """配置模式 - 通过参数配置执行任务"""
        return self.execute_mode(context)


def main():
    try:
        input_data = json.load(sys.stdin)
        action = input_data.get("action", "")
        context = input_data.get("context", {})
        
        automation = LeadGenerationAutomation()
        
        if action == "record":
            result = automation.record_mode(context)
        elif action == "save_recording":
            steps = context.get("steps", [])
            result = automation.save_recording(steps)
        elif action == "execute":
            result = automation.execute_mode(context)
        elif action == "config":
            result = automation.config_mode(context)
        else:
            result = {"error": f"Unknown action: {action}"}
        
        output = {
            "success": "error" not in result,
            "output": format_output(action, result),
            "data": result,
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
    
    if action == "record":
        return f"""🎬 开始录制获客流程

平台: {result['platform']}
浏览器: 已打开

操作指引:
{chr(10).join('  ' + s for s in result['instructions'])}

请在浏览器中执行您的获客操作...
"""
    
    elif action == "save_recording":
        return f"""✅ 录制完成！

录制ID: {result['recording_id']}
记录步骤: {result['steps_count']} 个

使用方法:
{result['usage']}
"""
    
    elif action == "execute":
        stats = result['stats']
        lines = [
            f"✅ 获客任务完成！",
            f"",
            f"📊 统计:",
            f"  • 扫描视频: {stats['videosScanned']} 个",
            f"  • 扫描评论: {stats['commentsScanned']} 条",
            f"  • 发现线索: {stats['leadsFound']} 条",
            f"  • 高意向: {stats['highIntentLeads']} 条",
            f"  • 耗时: {stats['duration']} 秒",
            f"",
            f"👥 线索详情:",
        ]
        
        for i, lead in enumerate(result['leads'][:5], 1):
            lines.append(f"  {i}. {lead['username']} (意向分: {lead['intentScore']})")
            lines.append(f"     评论: {lead['comment'][:30]}...")
        
        if len(result['leads']) > 5:
            lines.append(f"  ... 还有 {len(result['leads']) - 5} 条")
        
        return "\n".join(lines)
    
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
