#!/usr/bin/env python3
"""
瓷砖铺装排版生成器 v2.0
- 支持矩形 + 任意多边形（L型/凹凸户型）
- 障碍物裁剪（部分重叠时切割瓷砖而非整块移除）
- 输出数据契约供 smart-quotation 消费
"""

import json
import sys
import os
import math
from typing import List, Dict, Tuple, Optional

# Windows 编码修复
if sys.platform == 'win32':
    try:
        sys.stdin.reconfigure(encoding='utf-8', errors='replace')
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass


class Polygon:
    """简单多边形（凹/凸均可），用顶点列表表示"""

    def __init__(self, vertices: List[Tuple[float, float]]):
        """vertices: [(x, y), ...] 顺时针或逆时针"""
        self.vertices = vertices

    @classmethod
    def from_rect(cls, w: float, h: float) -> 'Polygon':
        return cls([(0, 0), (w, 0), (w, h), (0, h)])

    def contains_point(self, px: float, py: float) -> bool:
        """射线法判断点是否在多边形内"""
        n = len(self.vertices)
        inside = False
        j = n - 1
        for i in range(n):
            xi, yi = self.vertices[i]
            xj, yj = self.vertices[j]
            if ((yi > py) != (yj > py)) and \
               (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi):
                inside = not inside
            j = i
        return inside

    def contains_rect(self, x: float, y: float, w: float, h: float) -> bool:
        """判断矩形是否完全在多边形内（检查 4 角 + 中心）"""
        corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x + w / 2, y + h / 2)]
        return all(self.contains_point(cx, cy) for cx, cy in corners)

    def intersects_rect(self, x: float, y: float, w: float, h: float) -> bool:
        """判断矩形是否与多边形有交集（任一角在内部 = 有交集）"""
        corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        if any(self.contains_point(cx, cy) for cx, cy in corners):
            return True
        # 也检查多边形顶点是否在矩形内
        for vx, vy in self.vertices:
            if x <= vx <= x + w and y <= vy <= y + h:
                return True
        return False

    def bounds(self) -> Tuple[float, float, float, float]:
        """返回 (min_x, min_y, max_x, max_y)"""
        xs = [v[0] for v in self.vertices]
        ys = [v[1] for v in self.vertices]
        return min(xs), min(ys), max(xs), max(ys)


class TileLayout:
    """瓷砖排版类 v2.0"""

    def __init__(self, params: dict):
        # 房间定义：优先使用 room_polygon，否则用 room_width/room_height
        self.room_polygon: Optional[Polygon] = None
        if params.get("room_polygon"):
            self.room_polygon = Polygon([(v["x"], v["y"]) for v in params["room_polygon"]])
            b = self.room_polygon.bounds()
            self.room_width = b[2] - b[0]
            self.room_height = b[3] - b[1]
            self.offset_x = b[0]
            self.offset_y = b[1]
        else:
            self.room_width = params.get("room_width", 5000)  # mm
            self.room_height = params.get("room_height", 4000)  # mm
            self.room_polygon = Polygon.from_rect(self.room_width, self.room_height)
            self.offset_x = 0
            self.offset_y = 0

        self.tile_width = params.get("tile_width", 800)  # mm
        self.tile_height = params.get("tile_height", 800)  # mm
        self.pattern = params.get("pattern", "straight")
        self.grout_width = params.get("grout_width", 2)  # mm
        self.start_point = params.get("start_point", "center")
        self.price_per_piece = params.get("price_per_piece", 0)

        # 障碍物：支持矩形或多边形
        self.obstacles: List[Polygon] = []
        for obs in params.get("obstacles", []):
            if obs.get("polygon"):
                self.obstacles.append(Polygon([(v["x"], v["y"]) for v in obs["polygon"]]))
            elif obs.get("width") and obs.get("height"):
                self.obstacles.append(Polygon.from_rect(obs["width"], obs["height"]).__class__(
                    [(obs["x"], obs["y"]),
                     (obs["x"] + obs["width"], obs["y"]),
                     (obs["x"] + obs["width"], obs["y"] + obs["height"]),
                     (obs["x"], obs["y"] + obs["height"])]
                ))

        # 计算结果
        self.tiles: List[Dict] = []
        self.full_tiles = 0
        self.cut_tiles = 0
        self.waste_rate = 0.0
        self.total_tile_area = 0.0  # 实际铺设瓷砖面积 (mm²)

    def calculate(self) -> dict:
        """执行排版计算"""
        if self.pattern == "straight":
            self._calculate_straight()
        elif self.pattern == "staggered":
            self._calculate_staggered()
        elif self.pattern == "diagonal":
            self._calculate_diagonal()
        elif self.pattern == "herringbone":
            self._calculate_herringbone()
        else:
            self._calculate_straight()

        self._calculate_waste()

        # 计算实际铺设面积
        room_area = self._polygon_area(self.room_polygon)
        obstacle_area = sum(self._polygon_area(o) for o in self.obstacles)
        net_area = room_area - obstacle_area

        result = {
            "tiles": self.tiles,
            "full_tiles": self.full_tiles,
            "cut_tiles": self.cut_tiles,
            "total_pieces": self.full_tiles + self.cut_tiles,
            "waste_rate": round(self.waste_rate, 2),
            "total_area": round(net_area / 1000000, 2),  # m²
            "estimated_cost": round((self.full_tiles + self.cut_tiles) * self.price_per_piece, 2) if self.price_per_piece else 0,
            # === 数据契约：供 smart-quotation 消费 ===
            "tile_layout_output": {
                "room_area_m2": round(room_area / 1000000, 2),
                "net_area_m2": round(net_area / 1000000, 2),
                "tile_spec": f"{self.tile_width}x{self.tile_height}mm",
                "tile_area_m2": round(self.tile_width * self.tile_height / 1000000, 4),
                "pattern": self.pattern,
                "full_tiles": self.full_tiles,
                "cut_tiles": self.cut_tiles,
                "total_pieces": self.full_tiles + self.cut_tiles,
                "waste_rate_percent": round(self.waste_rate, 2),
                "total_tile_area_m2": round(
                    (self.full_tiles + self.cut_tiles) * self.tile_width * self.tile_height / 1000000, 2
                ),
                "estimated_cost": round((self.full_tiles + self.cut_tiles) * self.price_per_piece, 2) if self.price_per_piece else 0,
                "price_per_piece": self.price_per_piece,
                "grout_width_mm": self.grout_width,
            }
        }
        return result

    def _polygon_area(self, poly: Polygon) -> float:
        """鞋带公式计算多边形面积"""
        v = poly.vertices
        n = len(v)
        area = 0
        for i in range(n):
            j = (i + 1) % n
            area += v[i][0] * v[j][1]
            area -= v[j][0] * v[i][1]
        return abs(area) / 2

    def _tile_fits(self, x: float, y: float, w: float, h: float) -> bool:
        """瓷砖是否完全在房间内且不在任何障碍物内"""
        if not self.room_polygon.contains_rect(x, y, w, h):
            return False
        for obs in self.obstacles:
            if obs.intersects_rect(x, y, w, h):
                return False
        return True

    def _tile_partial(self, x: float, y: float, w: float, h: float) -> bool:
        """瓷砖是否部分在房间内（需要切割）"""
        if self.room_polygon.contains_rect(x, y, w, h):
            # 完全在房间内，检查是否与障碍物重叠
            for obs in self.obstacles:
                if obs.intersects_rect(x, y, w, h):
                    return True  # 需要切割避让
            return False  # 不需要切割
        return self.room_polygon.intersects_rect(x, y, w, h)

    def _add_tile(self, x: float, y: float, w: float, h: float, row: int, col: int, rotation: float = 0):
        """添加一块瓷砖"""
        is_full = self._tile_fits(x, y, w, h)
        is_cut = not is_full

        # 如果瓷砖完全在房间外，跳过
        if not self.room_polygon.intersects_rect(x, y, w, h):
            return

        # 检查是否完全在障碍物内（跳过）
        in_obstacle = False
        for obs in self.obstacles:
            if obs.contains_rect(x, y, w, h):
                in_obstacle = True
                break
        if in_obstacle:
            return

        tile = {
            "x": round(x, 2),
            "y": round(y, 2),
            "width": round(w, 2),
            "height": round(h, 2),
            "is_cut": is_cut,
            "row": row,
            "col": col,
        }
        if rotation:
            tile["rotation"] = rotation

        self.tiles.append(tile)
        if is_cut:
            self.cut_tiles += 1
        else:
            self.full_tiles += 1

    def _calculate_straight(self):
        """直铺计算"""
        if self.start_point == "center":
            start_x = (self.room_width % (self.tile_width + self.grout_width)) / 2
            start_y = (self.room_height % (self.tile_height + self.grout_width)) / 2
        else:
            start_x = 0
            start_y = 0

        step_x = self.tile_width + self.grout_width
        step_y = self.tile_height + self.grout_width

        col = 0
        x = start_x
        while x < self.room_width:
            row = 0
            y = start_y
            while y < self.room_height:
                actual_w = min(self.tile_width, self.room_width - x)
                actual_h = min(self.tile_height, self.room_height - y)
                self._add_tile(x, y, actual_w, actual_h, row, col)
                y += step_y
                row += 1
            x += step_x
            col += 1

    def _calculate_staggered(self):
        """工字铺计算（错缝1/2）"""
        if self.start_point == "center":
            start_x = (self.room_width % (self.tile_width + self.grout_width)) / 2
            start_y = (self.room_height % (self.tile_height + self.grout_width)) / 2
        else:
            start_x = 0
            start_y = 0

        step_x = self.tile_width + self.grout_width
        step_y = self.tile_height + self.grout_width

        col = 0
        x = start_x
        while x < self.room_width:
            offset_y = step_y / 2 if col % 2 == 1 else 0
            row = 0
            y = start_y + offset_y
            while y < self.room_height:
                actual_w = min(self.tile_width, self.room_width - x)
                actual_h = min(self.tile_height, self.room_height - y)
                if actual_h > 0 and actual_w > 0:
                    self._add_tile(x, y, actual_w, actual_h, row, col)
                y += step_y
                row += 1
            x += step_x
            col += 1

    def _calculate_diagonal(self):
        """斜铺计算（45度）"""
        diagonal = math.sqrt(self.room_width ** 2 + self.room_height ** 2)
        tile_size = (self.tile_width + self.tile_height) / 2
        step = tile_size + self.grout_width

        center_x = self.room_width / 2
        center_y = self.room_height / 2

        cols = int(diagonal / step) + 2

        for i in range(-cols // 2, cols // 2 + 1):
            for j in range(-cols // 2, cols // 2 + 1):
                x = center_x + (i - j) * step / math.sqrt(2)
                y = center_y + (i + j) * step / math.sqrt(2)

                if self._tile_partial(x, y, self.tile_width, self.tile_height):
                    # 裁剪到房间内
                    vx = max(0, x)
                    vy = max(0, y)
                    vw = min(x + self.tile_width, self.room_width) - vx
                    vh = min(y + self.tile_height, self.room_height) - vy
                    if vw > 10 and vh > 10:  # 太小的碎片跳过
                        self._add_tile(vx, vy, vw, vh, i, j, rotation=45)

    def _calculate_herringbone(self):
        """人字铺计算"""
        short_side = min(self.tile_width, self.tile_height)
        long_side = max(self.tile_width, self.tile_height)

        step_x = short_side + self.grout_width
        step_y = long_side + self.grout_width

        col = 0
        x = 0
        while x < self.room_width + long_side:
            row = 0
            y = 0
            while y < self.room_height + long_side:
                is_vertical = (col + row) % 2 == 0
                if is_vertical:
                    tw, th = short_side, long_side
                else:
                    tw, th = long_side, short_side

                actual_w = min(tw, self.room_width - x)
                actual_h = min(th, self.room_height - y)

                if actual_w > 10 and actual_h > 10:
                    rotation = 0 if is_vertical else 90
                    self._add_tile(x, y, actual_w, actual_h, row, col, rotation)

                y += step_y
                row += 1
            x += step_x
            col += 1

    def _calculate_waste(self):
        """计算损耗率"""
        total = self.full_tiles + self.cut_tiles
        if total == 0:
            self.waste_rate = 0
            return

        # 切割砖按半片计算损耗
        cut_waste = self.cut_tiles * 0.5
        # 施工损耗：3%
        construction_waste = total * 0.03
        # 特殊铺装方式增加损耗
        pattern_factor = 1.0
        if self.pattern == "diagonal":
            pattern_factor = 1.15
        elif self.pattern == "herringbone":
            pattern_factor = 1.20

        total_waste = (cut_waste + construction_waste) * pattern_factor
        self.waste_rate = (total_waste / total) * 100


def main():
    try:
        input_data = json.load(sys.stdin)

        layout = TileLayout(input_data)
        result = layout.calculate()

        os.makedirs("output", exist_ok=True)
        result_file = "output/layout_result.json"
        with open(result_file, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        print(json.dumps({
            "success": True,
            "stage": "layout",
            "result": result,
            "result_file": result_file,
            "message": f"排版完成：整砖{result['full_tiles']}片，切割砖{result['cut_tiles']}片，损耗率{result['waste_rate']}%"
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "stage": "layout",
            "error": str(e)
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
