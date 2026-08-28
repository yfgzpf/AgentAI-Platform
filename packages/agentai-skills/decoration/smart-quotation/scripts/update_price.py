#!/usr/bin/env python3
"""
价格库更新工具
- 查看当前价格
- 更新某个项目的单价
- 重置为默认
"""

import json
import sys
import os
from pathlib import Path

# Windows 编码修复
if sys.platform == 'win32':
    try:
        sys.stdin.reconfigure(encoding='utf-8', errors='replace')
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass

PRICE_LIB_FILE = Path(__file__).parent.parent / "price-library.json"

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


def load_user_prices() -> dict:
    if PRICE_LIB_FILE.exists():
        try:
            with open(PRICE_LIB_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}


def save_user_prices(data: dict):
    PRICE_LIB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PRICE_LIB_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    try:
        input_data = json.load(sys.stdin)
        action = input_data.get("action", "view")

        if action == "view":
            # 查看价格
            user_prices = load_user_prices()
            print(json.dumps({
                "success": True,
                "action": "view",
                "default_prices": DEFAULT_PRICES,
                "user_overrides": user_prices,
                "message": "当前价格库（含用户覆盖）"
            }, ensure_ascii=False, indent=2))

        elif action == "update":
            # 更新价格
            category = input_data.get("category", "")
            name = input_data.get("name", "")
            prices = input_data.get("prices", {})  # {economy: xx, standard: yy, luxury: zz}

            if not category or not name:
                print(json.dumps({"success": False, "error": "需要提供 category 和 name"}, ensure_ascii=False))
                sys.exit(1)

            user_prices = load_user_prices()
            if category not in user_prices:
                user_prices[category] = {}
            if name not in user_prices[category]:
                user_prices[category][name] = {}
            user_prices[category][name].update(prices)

            save_user_prices(user_prices)

            print(json.dumps({
                "success": True,
                "action": "update",
                "category": category,
                "name": name,
                "updated_prices": user_prices[category][name],
                "message": f"已更新 {category}/{name} 的价格"
            }, ensure_ascii=False, indent=2))

        elif action == "reset":
            # 重置
            if PRICE_LIB_FILE.exists():
                os.remove(PRICE_LIB_FILE)
            print(json.dumps({
                "success": True,
                "action": "reset",
                "message": "价格库已重置为默认值"
            }, ensure_ascii=False))

        else:
            print(json.dumps({"success": False, "error": f"未知操作: {action}"}, ensure_ascii=False))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
