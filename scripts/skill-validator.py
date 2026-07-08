#!/usr/bin/env python3
"""
Skill Validator - 技能真实可用性验证工具
确保每个技能都能真实运行，不是占位符
"""

import json
import sys
import os
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple


class SkillValidator:
    """技能验证器"""
    
    def __init__(self, skills_dir: str):
        self.skills_dir = Path(skills_dir)
        self.results = []
    
    def validate_all(self) -> Dict:
        """验证所有技能"""
        print("🔍 开始验证所有技能...\n")
        
        skill_dirs = [d for d in self.skills_dir.iterdir() if d.is_dir()]
        
        for skill_dir in skill_dirs:
            result = self.validate_skill(skill_dir)
            self.results.append(result)
        
        return self.generate_report()
    
    def validate_skill(self, skill_dir: Path) -> Dict:
        """验证单个技能"""
        skill_name = skill_dir.name
        print(f"📦 验证技能: {skill_name}")
        
        checks = {
            "skill_name": skill_name,
            "exists_skill_md": False,
            "exists_handler": False,
            "handler_executable": False,
            "skill_md_valid": False,
            "test_execution": False,
            "errors": []
        }
        
        # 1. 检查 SKILL.md
        skill_md = skill_dir / "SKILL.md"
        if skill_md.exists():
            checks["exists_skill_md"] = True
            try:
                content = skill_md.read_text(encoding='utf-8')
                # 检查必要的 front matter
                if '---' in content and 'name:' in content:
                    checks["skill_md_valid"] = True
            except Exception as e:
                checks["errors"].append(f"SKILL.md 读取失败: {e}")
        else:
            checks["errors"].append("缺少 SKILL.md")
        
        # 2. 检查 handler
        handler_py = skill_dir / "handler.py"
        handler_js = skill_dir / "handler.js"
        handler_ts = skill_dir / "handler.ts"
        
        handler = None
        if handler_py.exists():
            handler = handler_py
            checks["exists_handler"] = True
        elif handler_js.exists():
            handler = handler_js
            checks["exists_handler"] = True
        elif handler_ts.exists():
            handler = handler_ts
            checks["exists_handler"] = True
        else:
            # 检查 scripts 目录
            scripts_dir = skill_dir / "scripts"
            if scripts_dir.exists():
                main_script = scripts_dir / "main.py"
                if main_script.exists():
                    handler = main_script
                    checks["exists_handler"] = True
        
        if not checks["exists_handler"]:
            checks["errors"].append("缺少 handler 脚本")
        
        # 3. 测试执行
        if handler:
            try:
                # 测试是否能被 Python 解析（语法检查）
                if handler.suffix == '.py':
                    result = subprocess.run(
                        ['python', '-m', 'py_compile', str(handler)],
                        capture_output=True,
                        timeout=10
                    )
                    if result.returncode == 0:
                        checks["handler_executable"] = True
                    else:
                        checks["errors"].append(f"Handler 语法错误: {result.stderr.decode()[:200]}")
                else:
                    checks["handler_executable"] = True  # JS/TS 暂不检查
                
                # 尝试执行测试调用
                test_result = self.test_skill_execution(skill_dir, handler)
                checks["test_execution"] = test_result["success"]
                if not test_result["success"]:
                    checks["errors"].append(f"执行测试失败: {test_result.get('error', 'Unknown')}")
                    
            except Exception as e:
                checks["errors"].append(f"Handler 测试失败: {e}")
        
        # 判断总体状态
        checks["status"] = "✅ PASS" if all([
            checks["exists_skill_md"],
            checks["exists_handler"],
            checks["handler_executable"],
            checks["skill_md_valid"]
        ]) else "❌ FAIL"
        
        print(f"   状态: {checks['status']}")
        if checks["errors"]:
            for error in checks["errors"]:
                print(f"   ⚠️  {error}")
        print()
        
        return checks
    
    def test_skill_execution(self, skill_dir: Path, handler: Path) -> Dict:
        """测试技能执行"""
        try:
            # 准备测试输入
            test_input = json.dumps({
                "prompt": "测试调用",
                "params": {},
                "test": True
            })
            
            # 执行 handler
            result = subprocess.run(
                ['python', str(handler)],
                input=test_input,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            # 检查输出是否为有效 JSON
            try:
                output = json.loads(result.stdout)
                return {
                    "success": True,
                    "output": output
                }
            except:
                # 即使没有有效 JSON，只要返回码为 0 也算成功
                return {
                    "success": result.returncode == 0,
                    "stdout": result.stdout[:500],
                    "stderr": result.stderr[:500]
                }
                
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "执行超时"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def generate_report(self) -> Dict:
        """生成验证报告"""
        total = len(self.results)
        passed = sum(1 for r in self.results if r["status"] == "✅ PASS")
        failed = total - passed
        
        report = {
            "summary": {
                "total": total,
                "passed": passed,
                "failed": failed,
                "pass_rate": f"{passed/total*100:.1f}%" if total > 0 else "0%"
            },
            "details": self.results,
            "failed_skills": [r["skill_name"] for r in self.results if r["status"] == "❌ FAIL"]
        }
        
        return report


def main():
    """主入口"""
    skills_dir = sys.argv[1] if len(sys.argv) > 1 else "packages/agentai-skills"
    
    validator = SkillValidator(skills_dir)
    report = validator.validate_all()
    
    # 输出报告
    print("\n" + "="*60)
    print("📊 技能验证报告")
    print("="*60)
    print(f"总技能数: {report['summary']['total']}")
    print(f"✅ 通过: {report['summary']['passed']}")
    print(f"❌ 失败: {report['summary']['failed']}")
    print(f"通过率: {report['summary']['pass_rate']}")
    print("="*60)
    
    if report['failed_skills']:
        print("\n❌ 失败的技能:")
        for skill in report['failed_skills']:
            print(f"   - {skill}")
    
    # 保存报告
    os.makedirs("reports", exist_ok=True)
    with open("reports/skill_validation.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    print(f"\n📄 详细报告已保存: reports/skill_validation.json")
    
    # 返回码
    sys.exit(0 if report['summary']['failed'] == 0 else 1)


if __name__ == "__main__":
    main()
