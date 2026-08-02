#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CAD Control - AutoCAD CLI 控制技能
支持生成 .scr 脚本、执行 CAD 命令、DXF 文件读写
"""

import argparse
import json
import os
import sys
import subprocess
import tempfile
from typing import List, Dict, Any, Optional

try:
    import ezdxf
    from ezdxf import new
    from ezdxf.entities import Line, Circle, Text, LWPolyline, Dimension
    EZDXF_AVAILABLE = True
except ImportError:
    EZDXF_AVAILABLE = False
    print("[WARN] ezdxf not installed. Run: pip install ezdxf")


def generate_script(commands: List[Dict[str, Any]], output_path: str) -> Dict[str, Any]:
    """
    生成 AutoCAD .scr 脚本文件
    
    Args:
        commands: CAD 命令列表，格式 [{"cmd": "LINE", "args": ["0,0", "100,100"]}]
        output_path: 脚本输出路径
    
    Returns:
        {"success": True, "script_path": "...", "lines": N}
    """
    if not commands:
        return {"success": False, "error": "命令列表为空"}
    
    script_lines = []
    for cmd_obj in commands:
        cmd = cmd_obj.get("cmd", "").upper()
        args = cmd_obj.get("args", [])
        
        # AutoCAD 脚本格式：命令 + 参数（空格分隔）
        line = cmd
        for arg in args:
            line += f" {arg}"
        script_lines.append(line)
    
    # 添加保存命令
    script_lines.append("SAVEAS")
    script_lines.append(os.path.splitext(output_path)[0] + ".dwg")
    
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(script_lines))
        
        return {
            "success": True,
            "script_path": output_path,
            "lines": len(script_lines),
            "preview": script_lines[:5] if len(script_lines) > 5 else script_lines
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_autocad_path() -> Optional[str]:
    """
    查找 AutoCAD 安装路径
    
    Returns:
        AutoCAD acad.exe 路径，未找到返回 None
    """
    # Windows 常见安装路径
    common_paths = [
        r"C:\Program Files\Autodesk\AutoCAD 2024\acad.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2023\acad.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2022\acad.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2021\acad.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2020\acad.exe",
        r"C:\Program Files\Autodesk\AutoCAD 2019\acad.exe",
    ]
    
    for path in common_paths:
        if os.path.exists(path):
            return path
    
    # 尝试从注册表查找（Windows）
    if sys.platform == 'win32':
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Autodesk\AutoCAD")
            # 查找最新版本
            i = 0
            while True:
                try:
                    subkey_name = winreg.EnumKey(key, i)
                    if subkey_name.startswith("R"):
                        subkey = winreg.OpenKey(key, subkey_name)
                        acad_path, _ = winreg.QueryValueEx(subkey, "AcadLocation")
                        acad_exe = os.path.join(acad_path, "acad.exe")
                        if os.path.exists(acad_exe):
                            return acad_exe
                    i += 1
                except WindowsError:
                    break
        except Exception:
            pass
    
    return None


def execute_script(script_path: str, acad_path: Optional[str] = None) -> Dict[str, Any]:
    """
    执行 AutoCAD 脚本
    
    Args:
        script_path: .scr 脚本路径
        acad_path: AutoCAD 安装路径（可选）
    
    Returns:
        {"success": True, "output_path": "..."}
    """
    if not os.path.exists(script_path):
        return {"success": False, "error": f"脚本文件不存在: {script_path}"}
    
    # 查找 AutoCAD
    if not acad_path:
        acad_path = find_autocad_path()
    
    if not acad_path:
        return {
            "success": False,
            "error": "未找到 AutoCAD，请安装或指定 acad_path",
            "suggestion": "安装 AutoCAD 或使用 ODA File Converter"
        }
    
    try:
        # AutoCAD 命令行执行脚本
        # acad.exe /b script.scr
        cmd = [acad_path, "/b", script_path]
        
        # 执行（后台模式）
        subprocess.Popen(cmd, creationflags=subprocess.CREATE_NO_WINDOW)
        
        return {
            "success": True,
            "message": f"已启动 AutoCAD 执行脚本: {script_path}",
            "acad_path": acad_path
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def parse_dxf(file_path: str) -> Dict[str, Any]:
    """
    解析 DXF 文件，提取墙体/门窗/房间数据
    
    Args:
        file_path: DXF 文件路径
    
    Returns:
        {"success": True, "entities": [...], "rooms": [...]}
    """
    if not EZDXF_AVAILABLE:
        return {"success": False, "error": "ezdxf 未安装，请运行: pip install ezdxf"}
    
    if not os.path.exists(file_path):
        return {"success": False, "error": f"文件不存在: {file_path}"}
    
    try:
        doc = ezdxf.readfile(file_path)
        msp = doc.modelspace()
        
        entities = []
        rooms = []
        walls = []
        doors = []
        windows = []
        
        # 提取文本实体（房间名称）
        for text in msp.query("TEXT MTEXT"):
            content = text.dxf.text if hasattr(text.dxf, 'text') else text.text
            insert = text.dxf.insert if hasattr(text.dxf, 'insert') else text.dxf.location
            
            entities.append({
                "type": "TEXT",
                "content": content,
                "position": [insert.x, insert.y, insert.z] if hasattr(insert, '__iter__') else [insert[0], insert[1], 0],
                "layer": text.dxf.layer
            })
            
            # 判断是否为房间名称（常见关键词）
            room_keywords = ["客厅", "卧室", "厨房", "卫生间", "阳台", "书房", "餐厅", "玄关", "走廊"]
            if any(kw in content for kw in room_keywords):
                rooms.append({
                    "name": content,
                    "position": [insert.x, insert.y] if hasattr(insert, '__iter__') else [insert[0], insert[1]]
                })
        
        # 提取线段实体（墙体）
        for line in msp.query("LINE"):
            entities.append({
                "type": "LINE",
                "start": [line.dxf.start.x, line.dxf.start.y],
                "end": [line.dxf.end.x, line.dxf.end.y],
                "layer": line.dxf.layer
            })
            
            # 判断是否为墙体（根据图层名称）
            if "墙" in line.dxf.layer or "WALL" in line.dxf.layer.upper():
                walls.append({
                    "start": [line.dxf.start.x, line.dxf.start.y],
                    "end": [line.dxf.end.x, line.dxf.end.y],
                    "length": line.dxf.start.distance_to(line.dxf.end)
                })
        
        # 提取多段线（门窗）
        for polyline in msp.query("LWPOLYLINE POLYLINE"):
            entities.append({
                "type": "POLYLINE",
                "layer": polyline.dxf.layer,
                "points": len(polyline.vertices) if hasattr(polyline, 'vertices') else 0
            })
            
            # 判断是否为门窗
            layer_upper = polyline.dxf.layer.upper()
            if "门" in polyline.dxf.layer or "DOOR" in layer_upper:
                doors.append({"layer": polyline.dxf.layer})
            if "窗" in polyline.dxf.layer or "WINDOW" in layer_upper:
                windows.append({"layer": polyline.dxf.layer})
        
        # 提取尺寸标注
        dimensions = []
        for dim in msp.query("DIMENSION"):
            entities.append({
                "type": "DIMENSION",
                "layer": dim.dxf.layer,
                "text": dim.dxf.text if hasattr(dim.dxf, 'text') else ""
            })
        
        return {
            "success": True,
            "file_path": file_path,
            "entities_count": len(entities),
            "entities": entities[:50],  # 只返回前 50 个
            "rooms": rooms,
            "walls": walls[:20],
            "doors": doors,
            "windows": windows,
            "dimensions": dimensions[:20]
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def write_dxf(entities: List[Dict[str, Any]], output_path: str) -> Dict[str, Any]:
    """
    写入 DXF 文件
    
    Args:
        entities: 实体列表，格式 [{"type": "LINE", "start": [0,0], "end": [100,100]}]
        output_path: DXF 输出路径
    
    Returns:
        {"success": True, "file_path": "...", "entities_count": N}
    """
    if not EZDXF_AVAILABLE:
        return {"success": False, "error": "ezdxf 未安装，请运行: pip install ezdxf"}
    
    if not entities:
        return {"success": False, "error": "实体列表为空"}
    
    try:
        doc = new()
        msp = doc.modelspace()
        
        for entity in entities:
            etype = entity.get("type", "").upper()
            
            if etype == "LINE":
                start = entity.get("start", [0, 0])
                end = entity.get("end", [100, 100])
                msp.add_line(start, end)
            
            elif etype == "CIRCLE":
                center = entity.get("center", [50, 50])
                radius = entity.get("radius", 25)
                msp.add_circle(center, radius)
            
            elif etype == "TEXT":
                text = entity.get("text", "")
                position = entity.get("position", [0, 0])
                height = entity.get("height", 5)
                msp.add_text(text, dxfattribs={'height': height}).set_placement(position)
            
            elif etype == "POLYLINE":
                points = entity.get("points", [])
                if points:
                    msp.add_lwpolyline(points)
        
        doc.saveas(output_path)
        
        return {
            "success": True,
            "file_path": output_path,
            "entities_count": len(entities)
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="CAD Control - AutoCAD CLI 控制技能")
    parser.add_argument("--action", help="操作类型: generate_script/execute/parse_dxf/write_dxf")
    parser.add_argument("--commands", help="命令列表（JSON 格式）")
    parser.add_argument("--script-path", help="脚本路径")
    parser.add_argument("--output-path", help="输出路径")
    parser.add_argument("--file-path", help="DXF 文件路径")
    parser.add_argument("--entities", help="实体列表（JSON 格式）")
    parser.add_argument("--acad-path", help="AutoCAD 安装路径")
    parser.add_argument("--test", action="store_true", help="测试模式")
    
    args = parser.parse_args()
    
    if args.test:
        # 测试模式
        print("[TEST] CAD Control 测试")
        
        # 测试生成脚本
        test_commands = [
            {"cmd": "LINE", "args": ["0,0", "100,100"]},
            {"cmd": "CIRCLE", "args": ["50,50", "25"]},
            {"cmd": "TEXT", "args": ["50,50", "5", "0", "Test Room"]}
        ]
        result = generate_script(test_commands, "test.scr")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
        # 测试 DXF 写入
        if EZDXF_AVAILABLE:
            test_entities = [
                {"type": "LINE", "start": [0, 0], "end": [100, 100]},
                {"type": "CIRCLE", "center": [50, 50], "radius": 25},
                {"type": "TEXT", "text": "Test", "position": [50, 50], "height": 5}
            ]
            result = write_dxf(test_entities, "test.dxf")
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print("[WARN] ezdxf 未安装，跳过 DXF 测试")
        
        return
    
    # 执行操作
    action = args.action.lower() if args.action else ""
    
    if not action:
        print("[ERROR] 请指定 --action 参数")
        return
    
    if action == "generate_script":
        commands = json.loads(args.commands) if args.commands else []
        output_path = args.output_path or "output.scr"
        result = generate_script(commands, output_path)
    
    elif action == "execute":
        script_path = args.script_path
        acad_path = args.acad_path
        result = execute_script(script_path, acad_path)
    
    elif action == "parse_dxf":
        file_path = args.file_path
        result = parse_dxf(file_path)
    
    elif action == "write_dxf":
        entities = json.loads(args.entities) if args.entities else []
        output_path = args.output_path or "output.dxf"
        result = write_dxf(entities, output_path)
    
    else:
        result = {"success": False, "error": f"未知操作: {action}"}
    
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()