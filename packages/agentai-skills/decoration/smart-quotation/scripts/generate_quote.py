#!/usr/bin/env python3
"""
智能报价生成器 v2.0
- 支持从 tile-layout 结果自动导入工程量
- 价格库可更新（price-library.json）
- 输出数据来源标注
- Excel 报价单导出
"""

import json
import sys
import os
import time
from pathlib import Path

# Windows 编码修复
if sys.platform == 'win32':
    try:
        sys.stdin.reconfigure(encoding='utf-8', errors='replace')
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass


# 默认单价库
DEFAULT_PRICES = {
    "基础工程": {
        "拆除工程": {"unit": "m²", "economy": 30, "standard": 50, "luxury": 80},
        "水电改造": {"unit": "m", "economy": 80, "standard": 120, "luxury": 180},
        "防水工程": {"unit": "m²", "economy": 45, "standard": 70, "luxury": 120},
        "墙面处理": {"unit": "m²", "economy": 15, "standard": 25, "luxury": 45},
        "地面找平": {"unit": "m²", "economy": 20, "standard": 35, "luxury": 55},
        "垃圾清运": {"unit": "项", "economy": 300, "standard": 500, "luxury": 800},
    },
    "泥工工程": {
        "地砖铺贴": {"unit": "m²", "economy": 55, "standard": 85, "luxury": 150},
        "墙砖铺贴": {"unit": "m²", "economy": 50, "standard": 75, "luxury": 130},
        "踢脚线安装": {"unit": "m", "economy": 15, "standard": 25, "luxury": 40},
        "过门石安装": {"unit": "m", "economy": 30, "standard": 50, "luxury": 80},
    },
    "木工工程": {
        "吊顶": {"unit": "m²", "economy": 80, "standard": 150, "luxury": 300},
        "衣柜定制": {"unit": "m²", "economy": 400, "standard": 800, "luxury": 1500},
        "橱柜定制": {"unit": "延米", "economy": 800, "standard": 1500, "luxury": 3000},
        "门窗套": {"unit": "m", "economy": 50, "standard": 100, "luxury": 200},
    },
    "油漆工程": {
        "墙面乳胶漆": {"unit": "m²", "economy": 25, "standard": 35, "luxury": 60},
        "木器漆": {"unit": "m²", "economy": 40, "standard": 60, "luxury": 100},
        "腻子批刮": {"unit": "m²", "economy": 12, "standard": 20, "luxury": 35},
    },
    "安装工程": {
        "灯具安装": {"unit": "项", "economy": 300, "standard": 500, "luxury": 800},
        "卫浴安装": {"unit": "项", "economy": 200, "standard": 400, "luxury": 600},
        "开关插座": {"unit": "个", "economy": 15, "standard": 25, "luxury": 50},
    },
    "其他": {
        "管理费": {"unit": "项", "rate": 0.06},
        "设计费": {"unit": "项", "rate": 0.03},
        "清洁费": {"unit": "项", "economy": 500, "standard": 800, "luxury": 1500},
    }
}

# 价格库文件路径
PRICE_LIB_FILE = Path(__file__).parent.parent / "price-library.json"


def load_price_library() -> dict:
    """加载可更新的价格库（覆盖默认值）"""
    if PRICE_LIB_FILE.exists():
        try:
            with open(PRICE_LIB_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}


def get_effective_prices() -> dict:
    """合并默认价格 + 用户更新价格"""
    prices = json.loads(json.dumps(DEFAULT_PRICES))  # deep copy
    user_prices = load_price_library()
    for cat, items in user_prices.items():
        if cat not in prices:
            prices[cat] = {}
        for name, vals in items.items():
            if name not in prices[cat]:
                prices[cat][name] = {}
            prices[cat][name].update(vals)
    return prices


def load_tile_layout(tile_layout_file: str) -> dict:
    """从瓷砖排版结果文件加载工程量"""
    if not tile_layout_file or not os.path.exists(tile_layout_file):
        return {}

    try:
        with open(tile_layout_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # 如果是 handler 输出（有 tile_layout_output 字段）
        if "tile_layout_output" in data:
            return data["tile_layout_output"]
        # 如果是 layout_result.json（有 tile_layout_output 字段）
        if "result" in data and isinstance(data["result"], dict) and "tile_layout_output" in data["result"]:
            return data["result"]["tile_layout_output"]
        # 直接是 result
        if "tile_layout_output" in data:
            return data["tile_layout_output"]
        return {}
    except:
        return {}


def generate_quote(quantities: dict, tier: str, template: dict, project_info: dict,
                   tile_layout_data: dict = None) -> dict:
    """生成报价"""

    tier_field = {"economy": "economy", "standard": "standard", "luxury": "luxury"}.get(tier, "standard")
    prices = get_effective_prices()

    # 工程量数据
    total_area = quantities.get("total_area", 0)
    wall_area = quantities.get("wall_area_net", quantities.get("wall_area_gross", 0))
    floor_area = quantities.get("floor_area", total_area)
    ceiling_area = quantities.get("ceiling_area", total_area)
    materials = quantities.get("materials", {})

    # 数据来源追踪
    data_sources = {}

    # 如果有瓷砖排版数据，导入
    if tile_layout_data:
        tile_area = tile_layout_data.get("net_area_m2", tile_layout_data.get("room_area_m2", 0))
        floor_area = tile_area
        materials.setdefault("floor_tiles", {})
        materials["floor_tiles"]["area"] = tile_area
        materials["floor_tiles"]["pieces"] = tile_layout_data.get("total_pieces", 0)
        materials["floor_tiles"]["tile_spec"] = tile_layout_data.get("tile_spec", "")
        materials["floor_tiles"]["waste_rate"] = tile_layout_data.get("waste_rate_percent", 0)
        materials["floor_tiles"]["estimated_cost"] = tile_layout_data.get("estimated_cost", 0)
        data_sources["地砖铺贴面积"] = f"瓷砖排版导入 ({tile_area}m², {tile_layout_data.get('total_pieces', 0)}片)"
        if tile_layout_data.get("estimated_cost", 0) > 0:
            data_sources["瓷砖材料费"] = f"瓷砖排版导入 (¥{tile_layout_data['estimated_cost']})"

    quote_items = []
    data_source_tags = {}  # item name -> source tag

    def add_item(category, name, unit, quantity, unit_price, source="估算"):
        if quantity > 0 and unit_price > 0:
            subtotal = round(quantity * unit_price, 2)
            quote_items.append({
                "category": category,
                "name": name,
                "unit": unit,
                "quantity": round(quantity, 2),
                "unit_price": unit_price,
                "subtotal": subtotal,
                "source": source
            })

    def get_price(category, name):
        # 1. 学习模板
        if template and "learned_prices" in template:
            lp = template["learned_prices"]
            if name in lp:
                if tier == "economy":
                    return lp[name].get("min", lp[name].get("average", 0))
                elif tier == "luxury":
                    return lp[name].get("max", lp[name].get("average", 0))
                return lp[name].get("average", 0)
        # 2. 合并价格库
        if category in prices and name in prices[category]:
            item = prices[category][name]
            if "rate" in item:
                return item["rate"]
            return item.get(tier_field, 0)
        return 0

    # 基础工程
    add_item("基础工程", "拆除工程", "m²", total_area * 0.3, get_price("基础工程", "拆除工程"))
    add_item("基础工程", "水电改造", "m", total_area * 5, get_price("基础工程", "水电改造"))
    add_item("基础工程", "防水工程", "m²", total_area * 0.15, get_price("基础工程", "防水工程"))
    add_item("基础工程", "墙面处理", "m²", wall_area, get_price("基础工程", "墙面处理"))
    add_item("基础工程", "地面找平", "m²", floor_area, get_price("基础工程", "地面找平"), source="排版导入" if tile_layout_data else "估算")
    add_item("基础工程", "垃圾清运", "项", 1, get_price("基础工程", "垃圾清运"))

    # 泥工工程
    floor_tile_area = materials.get("floor_tiles", {}).get("area", floor_area)
    floor_tile_source = "排版导入" if tile_layout_data else "估算"
    add_item("泥工工程", "地砖铺贴", "m²", floor_tile_area, get_price("泥工工程", "地砖铺贴"), source=floor_tile_source)
    add_item("泥工工程", "墙砖铺贴", "m²", wall_area * 0.3, get_price("泥工工程", "墙砖铺贴"))
    add_item("泥工工程", "踢脚线安装", "m", total_area * 0.5, get_price("泥工工程", "踢脚线安装"))
    add_item("泥工工程", "过门石安装", "m", total_area * 0.1, get_price("泥工工程", "过门石安装"))

    # 木工工程
    add_item("木工工程", "吊顶", "m²", ceiling_area * 0.3, get_price("木工工程", "吊顶"))
    add_item("木工工程", "衣柜定制", "m²", total_area * 0.3, get_price("木工工程", "衣柜定制"))
    add_item("木工工程", "橱柜定制", "延米", total_area * 0.08, get_price("木工工程", "橱柜定制"))
    add_item("木工工程", "门窗套", "m", total_area * 0.3, get_price("木工工程", "门窗套"))

    # 油漆工程
    add_item("油漆工程", "墙面乳胶漆", "m²", wall_area, get_price("油漆工程", "墙面乳胶漆"))
    add_item("油漆工程", "木器漆", "m²", total_area * 0.1, get_price("油漆工程", "木器漆"))
    add_item("油漆工程", "腻子批刮", "m²", wall_area, get_price("油漆工程", "腻子批刮"))

    # 安装工程
    add_item("安装工程", "灯具安装", "项", 1, get_price("安装工程", "灯具安装"))
    add_item("安装工程", "卫浴安装", "项", 1, get_price("安装工程", "卫浴安装"))
    add_item("安装工程", "开关插座", "个", int(total_area * 0.8), get_price("安装工程", "开关插座"))

    # 小计
    subtotal = sum(item["subtotal"] for item in quote_items)

    # 其他费用
    management_fee = round(subtotal * 0.06, 2)
    design_fee = round(subtotal * 0.03, 2)
    cleaning_fee = prices["其他"]["清洁费"].get(tier_field, 800)

    add_item("其他", "管理费", "项", 1, management_fee, source="6% 计算")
    add_item("其他", "设计费", "项", 1, design_fee, source="3% 计算")
    add_item("其他", "清洁费", "项", 1, cleaning_fee)

    total = subtotal + management_fee + design_fee + cleaning_fee

    # 分类汇总
    breakdown = {}
    for item in quote_items:
        cat = item["category"]
        if cat not in breakdown:
            breakdown[cat] = {"items": 0, "total": 0}
        breakdown[cat]["items"] += 1
        breakdown[cat]["total"] += item["subtotal"]
    for cat in breakdown:
        breakdown[cat]["total"] = round(breakdown[cat]["total"], 2)

    return {
        "items": quote_items,
        "subtotal": round(subtotal, 2),
        "management_fee": management_fee,
        "design_fee": design_fee,
        "cleaning_fee": cleaning_fee,
        "total": round(total, 2),
        "per_sqm": round(total / total_area, 2) if total_area > 0 else 0,
        "breakdown": breakdown,
        "data_sources": data_sources,
    }


def export_excel(quote_data: dict, project_info: dict, template: dict) -> str:
    """导出Excel报价单"""
    try:
        import openpyxl
        from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
    except ImportError:
        return ""

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "报价单"

    # 样式
    header_font = Font(name='宋体', size=16, bold=True)
    normal_font = Font(name='宋体', size=11)
    bold_font = Font(name='宋体', size=11, bold=True)
    center = Alignment(horizontal='center', vertical='center')
    left = Alignment(horizontal='left', vertical='center')
    right = Alignment(horizontal='right', vertical='center')

    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
    category_fill = PatternFill(start_color='D6E4F0', end_color='D6E4F0', fill_type='solid')

    # 标题
    ws.merge_cells('A1:H1')
    ws['A1'] = f"{project_info.get('company', '装修报价单')}"
    ws['A1'].font = header_font
    ws['A1'].alignment = center

    # 项目信息
    ws.merge_cells('A2:H2')
    ws['A2'] = f"客户：{project_info.get('client_name', '')}    地址：{project_info.get('address', '')}    日期：{time.strftime('%Y-%m-%d')}"
    ws['A2'].font = normal_font
    ws['A2'].alignment = left

    # 表头（增加"数据来源"列）
    headers = ["序号", "项目名称", "规格", "单位", "数量", "单价(元)", "小计(元)", "数据来源"]
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=4, column=col, value=header)
        cell.font = Font(name='宋体', size=11, bold=True, color='FFFFFF')
        cell.alignment = center
        cell.border = thin_border
        cell.fill = header_fill

    # 数据行
    row = 5
    current_category = ""
    serial = 1

    for item in quote_data["items"]:
        if item["category"] != current_category:
            current_category = item["category"]
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=8)
            cell = ws.cell(row=row, column=1, value=current_category)
            cell.font = bold_font
            cell.alignment = left
            cell.fill = category_fill
            cell.border = thin_border
            row += 1

        ws.cell(row=row, column=1, value=serial).alignment = center
        ws.cell(row=row, column=2, value=item["name"]).alignment = left
        ws.cell(row=row, column=3, value="").alignment = center
        ws.cell(row=row, column=4, value=item["unit"]).alignment = center
        ws.cell(row=row, column=5, value=item["quantity"]).alignment = right
        ws.cell(row=row, column=6, value=item["unit_price"]).alignment = right
        ws.cell(row=row, column=7, value=item["subtotal"]).alignment = right
        ws.cell(row=row, column=8, value=item.get("source", "估算")).alignment = center

        for col in range(1, 9):
            ws.cell(row=row, column=col).border = thin_border
            ws.cell(row=row, column=col).font = normal_font

        row += 1
        serial += 1

    # 合计行
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
    ws.cell(row=row, column=1, value="合计").font = bold_font
    ws.cell(row=row, column=1).alignment = right
    ws.cell(row=row, column=7, value=quote_data["subtotal"]).font = bold_font
    ws.cell(row=row, column=7).alignment = right
    for col in range(1, 9):
        ws.cell(row=row, column=col).border = thin_border
        ws.cell(row=row, column=col).fill = PatternFill(start_color='FFF2CC', end_color='FFF2CC', fill_type='solid')
    row += 1

    # 管理费/设计费/清洁费
    for label, value, rate_str in [
        ("管理费", quote_data["management_fee"], " (6%)"),
        ("设计费", quote_data["design_fee"], " (3%)"),
        ("清洁费", quote_data["cleaning_fee"], ""),
    ]:
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
        ws.cell(row=row, column=1, value=f"{label}{rate_str}").font = normal_font
        ws.cell(row=row, column=1).alignment = right
        ws.cell(row=row, column=7, value=value).alignment = right
        ws.cell(row=row, column=7).font = normal_font
        for col in range(1, 9):
            ws.cell(row=row, column=col).border = thin_border
        row += 1

    # 总计
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
    ws.cell(row=row, column=1, value="总计 (大写)").font = Font(name='宋体', size=14, bold=True)
    ws.cell(row=row, column=1).alignment = right
    ws.cell(row=row, column=7, value=quote_data["total"]).font = Font(name='宋体', size=14, bold=True)
    ws.cell(row=row, column=7).alignment = right
    for col in range(1, 9):
        ws.cell(row=row, column=col).border = thin_border
        ws.cell(row=row, column=col).fill = PatternFill(start_color='FFD966', end_color='FFD966', fill_type='solid')
    row += 2

    # 每平米单价
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=8)
    ws.cell(row=row, column=1, value=f"每平米单价：¥{quote_data['per_sqm']}/m²").font = bold_font
    ws.cell(row=row, column=1).alignment = left
    row += 2

    # 备注
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=8)
    ws.cell(row=row, column=1, value='备注：\n1. 此报价不含家具、家电、软装\n2. 实际工程量以现场为准\n3. 报价有效期30天\n4. 标注「排版导入」的项目数据来自瓷砖排版计算结果').font = normal_font
    ws.cell(row=row, column=1).alignment = left

    # 列宽
    ws.column_dimensions['A'].width = 8
    ws.column_dimensions['B'].width = 25
    ws.column_dimensions['C'].width = 15
    ws.column_dimensions['D'].width = 8
    ws.column_dimensions['E'].width = 10
    ws.column_dimensions['F'].width = 12
    ws.column_dimensions['G'].width = 14
    ws.column_dimensions['H'].width = 20

    os.makedirs("output", exist_ok=True)
    output_file = f"output/quotation_{int(time.time())}.xlsx"
    wb.save(output_file)
    return output_file


def main():
    try:
        input_data = json.load(sys.stdin)

        quantities = input_data.get("quantities", {})
        tier = input_data.get("tier", "standard")
        project_info = input_data.get("project_info", {})
        template_id = input_data.get("template_id", "")
        tile_layout_file = input_data.get("tile_layout_file", "")

        # 加载瓷砖排版数据
        tile_layout_data = None
        if tile_layout_file:
            tile_layout_data = load_tile_layout(tile_layout_file)
            if tile_layout_data:
                # 用排版数据的面积覆盖工程量
                if "total_area" not in quantities and tile_layout_data.get("net_area_m2"):
                    quantities["total_area"] = tile_layout_data["net_area_m2"]
                    quantities.setdefault("floor_area", tile_layout_data["net_area_m2"])

        # 加载模板
        template = None
        if template_id:
            template_dir = os.path.join(os.path.expanduser("~"), ".agentai", "quotation-templates")
            template_file = os.path.join(template_dir, f"{template_id}.json")
            if os.path.exists(template_file):
                with open(template_file, "r", encoding="utf-8") as f:
                    template = json.load(f)

        # 生成报价
        quote_data = generate_quote(quantities, tier, template, project_info, tile_layout_data)

        # 导出Excel
        excel_file = export_excel(quote_data, project_info, template)

        output = {
            "success": True,
            "total": quote_data["total"],
            "per_sqm": quote_data["per_sqm"],
            "subtotal": quote_data["subtotal"],
            "management_fee": quote_data["management_fee"],
            "design_fee": quote_data["design_fee"],
            "cleaning_fee": quote_data["cleaning_fee"],
            "breakdown": quote_data["breakdown"],
            "item_count": len(quote_data["items"]),
            "excel_file": excel_file if excel_file else None,
            "tier": tier,
            "data_sources": quote_data.get("data_sources", {}),
            "tile_layout_imported": bool(tile_layout_data),
            "message": f"报价单已生成！总价¥{quote_data['total']:,.0f}，每平米¥{quote_data['per_sqm']}/m²"
        }

        print(json.dumps(output, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
