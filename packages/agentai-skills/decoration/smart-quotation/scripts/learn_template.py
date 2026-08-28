#!/usr/bin/env python3
"""
学习用户报价表模板
分析Excel/CSV文件结构，提取列名映射、项目分类、单价规律
"""

import json
import sys
import os
from pathlib import Path


def learn_from_excel(file_path: str) -> dict:
    """从Excel文件学习模板"""
    try:
        import openpyxl
        
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb.active
        
        # 读取所有行
        rows = list(ws.iter_rows(values_only=True))
        
        if not rows:
            return {"success": False, "error": "Excel文件为空"}
        
        # 识别表头行（包含"项目"/"单价"/"数量"等关键词的行）
        header_row_idx = -1
        column_mapping = {}
        
        keywords = {
            "name": ["项目名称", "项目", "分项", "工程名称", "内容", "名称"],
            "spec": ["规格", "型号", "材料", "品牌", "规格型号"],
            "unit": ["单位", "计量单位"],
            "quantity": ["数量", "工程量", "工程数量"],
            "price": ["单价", "价格", "单价(元)", "单价（元）"],
            "subtotal": ["小计", "金额", "合价", "小计(元)"],
            "remark": ["备注", "说明", "注释"]
        }
        
        for i, row in enumerate(rows[:10]):  # 前10行找表头
            for j, cell in enumerate(row):
                if cell is None:
                    continue
                cell_str = str(cell).strip()
                for field, kws in keywords.items():
                    if any(kw in cell_str for kw in kws):
                        column_mapping[field] = j
                        if header_row_idx < 0:
                            header_row_idx = i
        
        if header_row_idx < 0:
            header_row_idx = 0  # 默认第一行
        
        # 提取项目数据
        items = []
        current_category = "其他"
        
        for row in rows[header_row_idx + 1:]:
            if all(cell is None or str(cell).strip() == "" for cell in row):
                continue
            
            # 检测分类行（通常是合并单元格，只有一列有值）
            non_none = [c for c in row if c is not None and str(c).strip()]
            if len(non_none) == 1 and isinstance(non_none[0], str):
                current_category = str(non_none[0]).strip()
                continue
            
            # 提取项目
            name_idx = column_mapping.get("name")
            price_idx = column_mapping.get("price")
            unit_idx = column_mapping.get("unit")
            qty_idx = column_mapping.get("quantity")
            
            if name_idx is not None and name_idx < len(row):
                name = row[name_idx]
                if name is None or str(name).strip() == "":
                    continue
                
                item = {
                    "category": current_category,
                    "name": str(name).strip()
                }
                
                if unit_idx is not None and unit_idx < len(row) and row[unit_idx]:
                    item["unit"] = str(row[unit_idx]).strip()
                
                if price_idx is not None and price_idx < len(row) and row[price_idx] is not None:
                    try:
                        item["price"] = float(row[price_idx])
                    except (ValueError, TypeError):
                        pass
                
                if qty_idx is not None and qty_idx < len(row) and row[qty_idx] is not None:
                    try:
                        item["quantity"] = float(row[qty_idx])
                    except (ValueError, TypeError):
                        pass
                
                items.append(item)
        
        # 统计单价规律
        price_stats = {}
        for item in items:
            if "price" in item and item["price"] > 0:
                name = item["name"]
                if name not in price_stats:
                    price_stats[name] = {
                        "unit": item.get("unit", ""),
                        "prices": []
                    }
                price_stats[name]["prices"].append(item["price"])
        
        # 计算价格范围
        learned_prices = {}
        for name, data in price_stats.items():
            prices = data["prices"]
            if prices:
                learned_prices[name] = {
                    "unit": data["unit"],
                    "min": min(prices),
                    "max": max(prices),
                    "average": round(sum(prices) / len(prices), 2),
                    "count": len(prices)
                }
        
        # 提取分类
        categories = list(set(item["category"] for item in items))
        
        # 保存模板
        template_dir = os.path.join(os.path.expanduser("~"), ".agentai", "quotation-templates")
        os.makedirs(template_dir, exist_ok=True)
        
        template_id = f"tpl_{int(__import__('time').time())}"
        template_data = {
            "template_id": template_id,
            "source_file": file_path,
            "column_mapping": column_mapping,
            "categories": categories,
            "learned_prices": learned_prices,
            "item_count": len(items),
            "created_at": __import__('time').time()
        }
        
        template_file = os.path.join(template_dir, f"{template_id}.json")
        with open(template_file, "w", encoding="utf-8") as f:
            json.dump(template_data, f, ensure_ascii=False, indent=2)
        
        return {
            "success": True,
            "template_id": template_id,
            "learned_structure": {
                "columns": {k: v for k, v in column_mapping.items()},
                "categories": categories,
                "row_count": len(items)
            },
            "learned_prices": learned_prices,
            "template_file": template_file,
            "message": f"学习完成！识别到{len(items)}个报价项目，{len(categories)}个分类"
        }
        
    except ImportError:
        return {"success": False, "error": "需要安装openpyxl库: pip install openpyxl"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def learn_from_csv(file_path: str) -> dict:
    """从CSV文件学习模板"""
    try:
        import csv
        
        with open(file_path, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            rows = list(reader)
        
        if not rows:
            return {"success": False, "error": "CSV文件为空"}
        
        # 简化处理：用Excel的同样逻辑
        # 将CSV转换为临时Excel处理
        return learn_from_excel_converted(rows)
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def learn_from_excel_converted(rows: list) -> dict:
    """从行数据学习模板（CSV转换）"""
    # 简化实现，直接复用Excel逻辑
    header_row = rows[0] if rows else []
    
    column_mapping = {}
    keywords = {
        "name": ["项目名称", "项目", "分项", "名称"],
        "spec": ["规格", "型号", "材料"],
        "unit": ["单位", "计量单位"],
        "quantity": ["数量", "工程量"],
        "price": ["单价", "价格"],
        "subtotal": ["小计", "金额", "合价"],
        "remark": ["备注", "说明"]
    }
    
    for j, cell in enumerate(header_row):
        for field, kws in keywords.items():
            if any(kw in cell for kw in kws):
                column_mapping[field] = j
    
    # 提取项目
    items = []
    current_category = "其他"
    
    for row in rows[1:]:
        if not any(row):
            continue
        
        non_empty = [c for c in row if c.strip()]
        if len(non_empty) == 1:
            current_category = non_empty[0]
            continue
        
        name_idx = column_mapping.get("name", 0)
        if name_idx < len(row):
            name = row[name_idx].strip()
            if name:
                item = {"category": current_category, "name": name}
                if "unit" in column_mapping and column_mapping["unit"] < len(row):
                    item["unit"] = row[column_mapping["unit"]].strip()
                if "price" in column_mapping and column_mapping["price"] < len(row):
                    try:
                        item["price"] = float(row[column_mapping["price"]])
                    except ValueError:
                        pass
                items.append(item)
    
    # 统计单价
    learned_prices = {}
    for item in items:
        if "price" in item and item["price"] > 0:
            name = item["name"]
            if name not in learned_prices:
                learned_prices[name] = {"unit": item.get("unit", ""), "prices": []}
            learned_prices[name]["prices"].append(item["price"])
    
    # 计算范围
    for name, data in learned_prices.items():
        prices = data["prices"]
        learned_prices[name] = {
            "unit": data["unit"],
            "min": min(prices),
            "max": max(prices),
            "average": round(sum(prices) / len(prices), 2),
            "count": len(prices)
        }
    
    categories = list(set(item["category"] for item in items))
    
    # 保存
    template_dir = os.path.join(os.path.expanduser("~"), ".agentai", "quotation-templates")
    os.makedirs(template_dir, exist_ok=True)
    
    template_id = f"tpl_{int(__import__('time').time())}"
    template_data = {
        "template_id": template_id,
        "column_mapping": column_mapping,
        "categories": categories,
        "learned_prices": learned_prices,
        "item_count": len(items)
    }
    
    template_file = os.path.join(template_dir, f"{template_id}.json")
    with open(template_file, "w", encoding="utf-8") as f:
        json.dump(template_data, f, ensure_ascii=False, indent=2)
    
    return {
        "success": True,
        "template_id": template_id,
        "learned_structure": {
            "columns": column_mapping,
            "categories": categories,
            "row_count": len(items)
        },
        "learned_prices": learned_prices,
        "template_file": template_file,
        "message": f"学习完成！识别到{len(items)}个报价项目"
    }


def main():
    try:
        input_data = json.load(sys.stdin)
        file_path = input_data.get("template_file", "")
        
        if not os.path.exists(file_path):
            print(json.dumps({"success": False, "error": f"文件不存在: {file_path}"}))
            sys.exit(1)
        
        # 根据文件类型选择解析方式
        ext = Path(file_path).suffix.lower()
        
        if ext in ['.xlsx', '.xls']:
            result = learn_from_excel(file_path)
        elif ext == '.csv':
            result = learn_from_csv(file_path)
        else:
            print(json.dumps({"success": False, "error": f"不支持的文件格式: {ext}"}))
            sys.exit(1)
        
        print(json.dumps(result, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
