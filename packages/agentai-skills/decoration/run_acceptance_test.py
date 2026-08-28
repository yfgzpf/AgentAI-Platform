#!/usr/bin/env python3
"""
装修技能验收测试脚本 v2.0
验证 tile-layout-generator 和 smart-quotation 的核心能力
"""

import json
import sys
import os
import subprocess
from pathlib import Path

# Windows 编码修复
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass

SKILL_DIR = Path(__file__).parent
results = []


def run_test(name: str, handler_path: str, input_data: dict, work_dir: str = None) -> dict:
    """运行一个技能测试"""
    print(f"\n{'='*60}")
    print(f"测试: {name}")
    print(f"{'='*60}")

    if work_dir is None:
        work_dir = str(Path(handler_path).parent)

    try:
        result = subprocess.run(
            [sys.executable, str(Path(handler_path).resolve())],
            input=json.dumps(input_data, ensure_ascii=False),
            capture_output=True,
            timeout=120,
            encoding='utf-8',
            errors='replace',
            cwd=work_dir
        )

        if result.returncode != 0:
            print(f"❌ 执行失败 (exit code {result.returncode})")
            print(f"stderr: {result.stderr[:500]}")
            return {"name": name, "pass": False, "error": result.stderr[:200]}

        output = json.loads(result.stdout)
        return {"name": name, "pass": output.get("success", False), "output": output}

    except Exception as e:
        print(f"❌ 异常: {e}")
        return {"name": name, "pass": False, "error": str(e)}


def assert_true(test_name: str, condition: bool, detail: str = ""):
    """断言"""
    status = "✅" if condition else "❌"
    msg = f"  {status} {test_name}"
    if detail:
        msg += f" — {detail}"
    print(msg)
    results.append({"test": test_name, "pass": condition, "detail": detail})


def read_layout_result(work_dir: str, result_file: str) -> dict:
    """读取排版结果文件"""
    # result_file 可能是相对路径，拼接 work_dir
    if not os.path.isabs(result_file):
        result_file = os.path.join(work_dir, result_file)
    if os.path.exists(result_file):
        with open(result_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def test_tile_layout():
    """测试瓷砖排版"""
    tile_dir = SKILL_DIR / "tile-layout-generator"
    handler = tile_dir / "handler.py"
    work_dir = str(tile_dir)

    # T1: 矩形房间直铺
    r = run_test("T1: 矩形房间直铺", handler, {
        "params": {
            "room_width": 5000,
            "room_height": 4000,
            "tile_width": 800,
            "tile_height": 800,
            "pattern": "straight",
            "grout_width": 2,
            "start_point": "center"
        }
    }, work_dir=work_dir)

    if r["pass"]:
        out = r["output"]
        ml = out.get("material_list", {})
        assert_true("T1-整砖数>0", ml.get("full_tiles", 0) > 0, f"整砖={ml.get('full_tiles')}")
        assert_true("T1-切割砖数>0", ml.get("cut_tiles", 0) > 0, f"切割砖={ml.get('cut_tiles')}")
        assert_true("T1-损耗率合理", 0 < ml.get("waste_rate", 0) < 50, f"损耗率={ml.get('waste_rate')}%")
        assert_true("T1-总面积正确", ml.get("total_area") == 20.0, f"面积={ml.get('total_area')}m²")
        assert_true("T1-SVG文件生成", out.get("files", {}).get("svg") is not None)
        assert_true("T1-DXF文件生成", out.get("files", {}).get("dxf") is not None)
        assert_true("T1-数据契约存在", "tile_layout_output" in out, f"tile_layout_output={'有' if 'tile_layout_output' in out else '无'}")
        tlo = out.get("tile_layout_output", {})
        assert_true("T1-契约字段完整", all(k in tlo for k in ["room_area_m2", "net_area_m2", "total_pieces", "tile_spec"]), f"字段={list(tlo.keys())}")
        assert_true("T1-Widget SVG内容", bool(out.get("widget", {}).get("svg")), "SVG内联到widget")
    else:
        assert_true("T1-执行成功", False, r.get("error", ""))

    # T2: 工字铺
    r2 = run_test("T2: 工字铺", handler, {
        "params": {
            "room_width": 5000,
            "room_height": 4000,
            "tile_width": 800,
            "tile_height": 800,
            "pattern": "staggered"
        }
    }, work_dir=work_dir)

    if r2["pass"]:
        out = r2["output"]
        ml = out.get("material_list", {})
        assert_true("T2-工字铺执行成功", True, f"整砖={ml.get('full_tiles')}, 切割砖={ml.get('cut_tiles')}")
    else:
        assert_true("T2-工字铺执行成功", False, r2.get("error", ""))

    # T3: 带障碍物
    r3 = run_test("T3: 带障碍物", handler, {
        "params": {
            "room_width": 6000,
            "room_height": 5000,
            "tile_width": 600,
            "tile_height": 1200,
            "pattern": "straight",
            "obstacles": [
                {"x": 2800, "y": 2300, "width": 400, "height": 400}
            ]
        }
    }, work_dir=work_dir)

    if r3["pass"]:
        out = r3["output"]
        ml = out.get("material_list", {})
        assert_true("T3-障碍物处理成功", True, f"整砖={ml.get('full_tiles')}, 切割砖={ml.get('cut_tiles')}")
        # 验证障碍物区域没有瓷砖
        result_file = out.get("files", {}).get("json", "")
        layout = read_layout_result(work_dir, result_file)
        if layout:
            tiles = layout.get("tiles", [])
            obs_x, obs_y = 2800, 2300
            obs_w, obs_h = 400, 400
            tiles_in_obstacle = [
                t for t in tiles
                if t["x"] >= obs_x and t["y"] >= obs_y
                and t["x"] + t["width"] <= obs_x + obs_w
                and t["y"] + t["height"] <= obs_y + obs_h
            ]
            assert_true("T3-障碍物内无瓷砖", len(tiles_in_obstacle) == 0, f"障碍物内瓷砖数={len(tiles_in_obstacle)}")
        else:
            assert_true("T3-障碍物内无瓷砖", False, "无法读取结果文件")
    else:
        assert_true("T3-障碍物处理成功", False, r3.get("error", ""))

    # T4: L型户型
    r4 = run_test("T4: L型凹凸户型", handler, {
        "params": {
            "room_polygon": [
                {"x": 0, "y": 0},
                {"x": 6000, "y": 0},
                {"x": 6000, "y": 4000},
                {"x": 3000, "y": 4000},
                {"x": 3000, "y": 6000},
                {"x": 0, "y": 6000}
            ],
            "tile_width": 800,
            "tile_height": 800,
            "pattern": "straight"
        }
    }, work_dir=work_dir)

    if r4["pass"]:
        out = r4["output"]
        ml = out.get("material_list", {})
        assert_true("T4-L型户型成功", True, f"整砖={ml.get('full_tiles')}, 切割砖={ml.get('cut_tiles')}")
    else:
        assert_true("T4-L型户型成功", False, r4.get("error", ""))

    # T5: 斜铺
    r5 = run_test("T5: 斜铺45°", handler, {
        "params": {
            "room_width": 4000,
            "room_height": 3000,
            "tile_width": 600,
            "tile_height": 600,
            "pattern": "diagonal"
        }
    }, work_dir=work_dir)

    if r5["pass"]:
        out = r5["output"]
        ml = out.get("material_list", {})
        assert_true("T5-斜铺成功", True, f"整砖={ml.get('full_tiles')}, 切割砖={ml.get('cut_tiles')}")
    else:
        assert_true("T5-斜铺成功", False, r5.get("error", ""))

    # T6: 自然语言
    r6 = run_test("T6: 自然语言输入", handler, {
        "prompt": "客厅5米乘4米，800x800砖，工字铺，留缝2毫米"
    }, work_dir=work_dir)

    if r6["pass"]:
        out = r6["output"]
        params = out.get("params", {})
        assert_true("T6-自然语言解析", params.get("room_width") == 5000 and params.get("pattern") == "staggered",
                     f"width={params.get('room_width')}, pattern={params.get('pattern')}")
    else:
        assert_true("T6-自然语言解析", False, r6.get("error", ""))

    # 返回 T1 的结果文件路径（绝对路径），供报价测试用
    if r["pass"]:
        result_file = r["output"].get("files", {}).get("json", "")
        if result_file and not os.path.isabs(result_file):
            result_file = os.path.join(work_dir, result_file)
        return result_file
    return ""


def test_quotation(tile_layout_file: str):
    """测试报价生成"""
    quote_dir = SKILL_DIR / "smart-quotation"
    handler = quote_dir / "handler.py"
    work_dir = str(quote_dir)

    # Q1: 基础报价
    r = run_test("Q1: 基础报价", handler, {
        "mode": "generate",
        "quantities": {"total_area": 100, "wall_area_gross": 280},
        "tier": "standard",
        "project_info": {"client_name": "测试客户", "address": "测试地址"}
    }, work_dir=work_dir)

    if r["pass"]:
        out = r["output"]
        assert_true("Q1-报价生成成功", True)
        assert_true("Q1-总价>0", out.get("total", 0) > 0, f"总价=¥{out.get('total')}")
        assert_true("Q1-每平米在合理范围", 800 < out.get("per_sqm", 0) < 5000, f"¥{out.get('per_sqm')}/m²")
        assert_true("Q1-Excel文件生成", out.get("excel_file") is not None, f"文件={out.get('excel_file')}")
        assert_true("Q1-分类汇总存在", "breakdown" in out, f"分类={list(out.get('breakdown', {}).keys())}")
    else:
        assert_true("Q1-报价生成成功", False, r.get("error", ""))

    # Q2: 三档对比
    tiers = ["economy", "standard", "luxury"]
    tier_totals = {}
    for tier in tiers:
        r_tier = run_test(f"Q2: {tier}档", handler, {
            "mode": "generate",
            "quantities": {"total_area": 100, "wall_area_gross": 280},
            "tier": tier
        }, work_dir=work_dir)
        if r_tier["pass"]:
            tier_totals[tier] = r_tier["output"].get("total", 0)

    if len(tier_totals) == 3:
        assert_true("Q2-三档递增",
                     tier_totals["economy"] < tier_totals["standard"] < tier_totals["luxury"],
                     f"经济=¥{tier_totals['economy']}, 标准=¥{tier_totals['standard']}, 豪华=¥{tier_totals['luxury']}")
    else:
        assert_true("Q2-三档全部成功", False, f"仅成功{len(tier_totals)}档")

    # Q3: 从排版结果导入
    if tile_layout_file and os.path.exists(tile_layout_file):
        r3 = run_test("Q3: 从排版结果导入", handler, {
            "mode": "generate",
            "tile_layout_file": tile_layout_file,
            "tier": "standard",
            "project_info": {"client_name": "排版导入测试"}
        }, work_dir=work_dir)

        if r3["pass"]:
            out = r3["output"]
            assert_true("Q3-排版导入成功", out.get("tile_layout_imported", False), f"tile_layout_imported={out.get('tile_layout_imported')}")
            assert_true("Q3-数据来源标注", len(out.get("data_sources", {})) > 0, f"来源={out.get('data_sources')}")
        else:
            assert_true("Q3-排版导入成功", False, r3.get("error", ""))
    else:
        assert_true("Q3-排版导入成功", False, f"排版结果文件不存在: {tile_layout_file}")

    # Q4: 价格更新
    r4a = run_test("Q4a: 更新价格", handler, {
        "mode": "price",
        "action": "update",
        "category": "泥工工程",
        "name": "地砖铺贴",
        "prices": {"economy": 100, "standard": 200, "luxury": 400}
    }, work_dir=work_dir)
    assert_true("Q4a-价格更新成功", r4a["pass"], r4a.get("error", ""))

    # 用更新后的价格重新生成
    r4b = run_test("Q4b: 验证新价格生效", handler, {
        "mode": "generate",
        "quantities": {"total_area": 100, "wall_area_gross": 280},
        "tier": "standard"
    }, work_dir=work_dir)

    if r4b["pass"] and r["pass"]:
        out = r4b["output"]
        assert_true("Q4b-新价格生效", out.get("total", 0) > r.get("total", 0), f"新总价=¥{out.get('total')} > 原总价=¥{r.get('total')}")
    else:
        assert_true("Q4b-新价格生效", False, r4b.get("error", ""))

    # Q4c: 重置价格
    r4c = run_test("Q4c: 重置价格", handler, {
        "mode": "price",
        "action": "reset"
    }, work_dir=work_dir)
    assert_true("Q4c-价格重置成功", r4c["pass"])

    # Q5: 分类汇总正确性
    r5 = run_test("Q5: 分类汇总", handler, {
        "mode": "generate",
        "quantities": {"total_area": 100, "wall_area_gross": 280},
        "tier": "standard"
    }, work_dir=work_dir)

    if r5["pass"]:
        out = r5["output"]
        breakdown = out.get("breakdown", {})
        # breakdown 包含所有分类（含"其他"），subtotal 是不含"其他"的小计
        # 验证: subtotal + management_fee + design_fee + cleaning_fee = total
        subtotal = out.get("subtotal", 0)
        mgmt = out.get("management_fee", 0)
        design = out.get("design_fee", 0)
        cleaning = out.get("cleaning_fee", 0)
        total = out.get("total", 0)
        expected_total = subtotal + mgmt + design + cleaning
        assert_true("Q5-分类汇总=小计", abs(expected_total - total) < 1, f"小计+费用=¥{expected_total}, 总计=¥{total}")
    else:
        assert_true("Q5-分类汇总", False, r5.get("error", ""))


def test_deprecation():
    """测试废弃标记"""
    deprecated_skills = [
        "cad-ai-designer",
        "sketch-to-cad",
        "hvac-designer",
        "plumbing-layout-generator",
        "construction-supervisor",
        "requirement-interview",
        "material-selector",
    ]

    for skill in deprecated_skills:
        skill_md = SKILL_DIR / skill / "SKILL.md"
        if skill_md.exists():
            content = skill_md.read_text(encoding='utf-8')
            has_deprecated = "status: deprecated" in content
            assert_true(f"废弃-{skill}", has_deprecated, f"status: deprecated {'存在' if has_deprecated else '缺失'}")
        else:
            assert_true(f"废弃-{skill}", False, "SKILL.md 不存在")


def main():
    print("=" * 60)
    print("装修技能验收测试 v2.0")
    print("=" * 60)

    # 1. 瓷砖排版测试
    tile_layout_file = test_tile_layout()

    # 2. 报价生成测试
    test_quotation(tile_layout_file)

    # 3. 废弃标记测试
    test_deprecation()

    # 汇总
    print(f"\n{'='*60}")
    print("验收汇总")
    print(f"{'='*60}")
    total = len(results)
    passed = sum(1 for r in results if r["pass"])
    failed = total - passed

    for r in results:
        status = "✅" if r["pass"] else "❌"
        print(f"  {status} {r['test']}")

    print(f"\n总计: {total} 项 | 通过: {passed} | 失败: {failed}")
    print(f"通过率: {passed/total*100:.1f}%")

    if failed == 0:
        print("\n🎉 所有验收项通过！")
        return 0
    else:
        print(f"\n⚠️ {failed} 项未通过，需要修复")
        return 1


if __name__ == "__main__":
    sys.exit(main())
