# -*- coding: utf-8 -*-
"""
地块几何反算（Site Geometry Reverse-Calculation）
=================================================

用途：由界址点（或任意闭合多边形顶点）的大地坐标 / 图面坐标，反算：
  1. 局部正交坐标系下的顶点坐标
  2. 各边长、闭合面积（与图纸标注面积交叉校验）
  3. 四边方位角（判断真实朝向，不靠"感觉朝南"）
  4. 东/西界的倾斜量（放线必须知道，处理斜界）
  5. 最大内接矩形（判断主体能放到多大）
  6. 轴网推导（把可用尺寸切成等开间 × 等进深九宫格）

核心原则：**面积必须闭合**。反算面积若与图纸标注面积差超过 1%，
说明界址点抄录有误，此时不得继续出图，必须先核对原始测绘成果。

输入格式（JSON）：
{
  "points": [
    {"id": "J1", "x": 2690387.024, "y": 39587657.342},
    ...
  ],
  "closure": true,            // 是否按顺序闭合成多边形
  "stated_area": 110.00,      // 图纸标注面积，用于校验（可选）
  "stated_edges": {"J1-J2": 10.68, "J2-J3": 12.60},  // 图纸标注边长（可选）
  "margin": 0.15,             // 内接矩形四边退让（米）
  "grid": {"count_x": 3, "count_y": 3}   // 轴网等分格数
}

输出格式（JSON）：见 main() 末尾 result 结构。

命令行：
  python site_geometry.py                 # 用内置自检样例
  python site_geometry.py input.json      # 读文件
  cat input.json | python site_geometry.py -   # 读 stdin
"""

import json
import math
import sys


# ----------------------------------------------------------------------
# 1. 局部坐标系
# ----------------------------------------------------------------------
def to_local(points, ref_edge=("J1", "J2")):
    """把大地坐标转到局部正交系。

    约定（本技能全库统一，务必遵守）：
        原点 = ref_edge[0]
        +X   = 沿 ref_edge[0] -> ref_edge[1]（即图纸水平方向，向右）
        +Y   = +X 顺时针 90°（即图纸垂直方向，真实北向可能在图纸上方）
        图纸绘制时 +Y 向下，因此图纸上方 = +Y 大 = 若北在图纸上方则可直接读图。

    返回 (local_points, meta)
    """
    by_id = {p["id"]: p for p in points}
    a, b = ref_edge
    if a not in by_id or b not in by_id:
        raise ValueError("参考边 %s-%s 的点不在输入中" % (a, b))

    x0, y0 = by_id[a]["x"], by_id[a]["y"]
    vx, vy = by_id[b]["x"] - x0, by_id[b]["y"] - y0
    length = math.hypot(vx, vy)
    if length < 1e-9:
        raise ValueError("参考边两点重合，无法定向")
    ux, uy = vx / length, vy / length

    local = {}
    for p in points:
        dx, dy = p["x"] - x0, p["y"] - y0
        local[p["id"]] = {
            "x": round(dx * ux + dy * uy, 4),
            "y": round(-dx * uy + dy * ux, 4),
        }

    # 方位角：北起顺时针。测量坐标系 X 为北、Y 为东。
    az = math.degrees(math.atan2(vx, vy)) % 360
    meta = {
        "ref_edge": "%s-%s" % (a, b),
        "ref_edge_length": round(length, 4),
        "bearing_x": round(az, 4),            # +X 轴方位角 N??E
        "bearing_y": round((az + 90) % 360, 4),  # +Y 轴方位角
    }
    return local, meta


# ----------------------------------------------------------------------
# 2. 边长 / 面积 / 闭合
# ----------------------------------------------------------------------
def edges_and_area(order, local, bearing_offset=0.0):
    """逐边给出长度、局部方位角与真实方位角（北起顺时针）。

    bearing_offset = 局部 +X 轴的真实方位角（由 to_local 的 meta['bearing_x'] 提供）。
    真实方位角 = (局部方位角 + bearing_offset) % 360，可直接写进图纸说明。
    """
    edges = []
    for i in range(len(order)):
        a = order[i]
        b = order[(i + 1) % len(order)]
        pa, pb = local[a], local[b]
        lb = math.degrees(math.atan2(pb["x"] - pa["x"], pb["y"] - pa["y"])) % 360
        edges.append({
            "from": a, "to": b,
            "length": round(math.hypot(pb["x"] - pa["x"], pb["y"] - pa["y"]), 4),
            "bearing_local": round(lb, 4),
            "bearing_true": round((lb + bearing_offset) % 360, 4),
        })

    area2 = 0.0
    for i in range(len(order)):
        a = local[order[i]]
        b = local[order[(i + 1) % len(order)]]
        area2 += a["x"] * b["y"] - b["x"] * a["y"]
    return edges, abs(area2) / 2.0


def check_closure(edges, stated_edges, tol=0.02):
    """与图纸标注边长逐条比对。tol 单位：米。"""
    out = []
    for e in edges:
        key = "%s-%s" % (e["from"], e["to"])
        rkey = "%s-%s" % (e["to"], e["from"])
        stated = None
        if stated_edges:
            stated = stated_edges.get(key, stated_edges.get(rkey))
        if stated is None:
            continue
        diff = round(e["length"] - float(stated), 4)
        out.append({
            "edge": key,
            "computed": e["length"],
            "stated": float(stated),
            "diff_m": diff,
            "ok": abs(diff) <= tol,
        })
    return out


# ----------------------------------------------------------------------
# 3. 几何特征：外包框、斜界、内接矩形
# ----------------------------------------------------------------------
def bbox(local):
    xs = [p["x"] for p in local.values()]
    ys = [p["y"] for p in local.values()]
    return {"x": [min(xs), max(xs)], "y": [min(ys), max(ys)],
            "w": round(max(xs) - min(xs), 4),
            "d": round(max(ys) - min(ys), 4)}


def east_west_slant(order, local):
    """检测东西界是否倾斜（南北向边的东西向偏移）。

    对每条接近南北向的边，给出水平偏移量与倾角。
    该值必须写进图纸说明：若按垂直放线，退线会差出这个数。
    """
    res = []
    for i in range(len(order)):
        a = local[order[i]]
        b = local[order[(i + 1) % len(order)]]
        dx, dy = b["x"] - a["x"], b["y"] - a["y"]
        if abs(dy) < 1e-6:
            continue
        if abs(dy) < abs(dx) * 3:      # 只挑南北向的边
            continue
        res.append({
            "edge": "%s-%s" % (order[i], order[(i + 1) % len(order)]),
            "dx": round(dx, 4),
            "dy": round(dy, 4),
            "lean_deg": round(math.degrees(math.atan2(dx, dy)), 4),
            "note": "南北向边水平偏移 %.3f m；须按实测坐标放线，不可当垂直线" % dx,
        })
    return res


def max_inscribed_rect(order, local, margin=0.0, y_step=0.05):
    """在多边形内找最大面积的正交矩形。

    算法（顶点候选法，复杂度 O(nx^2 · ny · n)，10 顶点地块 < 20 万次运算）：
      1. 候选左右边 = 各顶点 x 值 ± margin，加上边界 margin 位置；
      2. 枚举候选左右边对，得到宽度 w；
      3. 沿 y 以 y_step 扫描，找出「整幅宽度都在形内」的最长连续段，即该宽度下的最大高度；
      4. 取面积最大者。

    说明：最优解的左右边通常落在顶点 x 上，故顶点候选法对界址地块（近正交）足够精确；
    若地块含斜边，结果偏保守（偏小），不会高估。y_step 越小越精，代价是线性变慢。

    ⚠️ 严禁改回「逐宽度 × 逐高度」的双重递减扫描 —— 那是五重嵌套，
       10.8×12.6 m 的地块要跑 7×10^11 次，必然超时（本技能 v1.0 踩过此坑）。
    """
    pts = [local[k] for k in order]
    xs = sorted({round(p["x"], 3) for p in pts})
    ys = sorted({round(p["y"], 3) for p in pts})
    x_lo, x_hi = xs[0] + margin, xs[-1] - margin
    y_lo, y_hi = ys[0] + margin, ys[-1] - margin
    if x_hi - x_lo < 1.0 or y_hi - y_lo < 1.0:
        return None

    def inside(x, y):
        c = False
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            if (a["y"] > y) != (b["y"] > y):
                xx = (b["x"] - a["x"]) * (y - a["y"]) / (b["y"] - a["y"]) + a["x"]
                if x < xx:
                    c = not c
        return c

    def span_ok(x0, x1, y):
        """水平段 x0~x1 在 y 高度上整段位于形内。"""
        eps = 1e-4
        if not inside(x0 + eps, y) or not inside(x1 - eps, y):
            return False
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            if (a["y"] > y) != (b["y"] > y):
                xc = (b["x"] - a["x"]) * (y - a["y"]) / (b["y"] - a["y"]) + a["x"]
                if x0 + eps < xc < x1 - eps:
                    return False
        return True

    cand = sorted({round(v, 3) for v in
                   [x_lo, x_hi]
                   + [x + margin for x in xs] + [x - margin for x in xs]
                   if x_lo - 1e-6 <= v <= x_hi + 1e-6})

    n_y = int((y_hi - y_lo) / y_step) + 1
    best = None
    for i in range(len(cand)):
        for j in range(i + 1, len(cand)):
            x0, x1 = cand[i], cand[j]
            w = x1 - x0
            if w < 1.0:
                continue
            run = 0.0
            best_run = 0.0
            best_y0 = None
            y_start = None
            for k in range(n_y):
                y = y_lo + k * y_step
                if span_ok(x0, x1, y):
                    if run == 0.0:
                        y_start = y
                    run += y_step
                    if run > best_run:
                        best_run = run
                        best_y0 = y_start
                else:
                    run = 0.0
            if best_run >= 1.0 and best_y0 is not None:
                area = w * best_run
                if best is None or area > best["area"]:
                    best = {"w": round(w, 3), "d": round(best_run, 3),
                            "area": round(area, 2),
                            "anchor_x": round(x0, 3), "anchor_y": round(best_y0, 3)}
    return best


# ----------------------------------------------------------------------
# 4. 轴网推导
# ----------------------------------------------------------------------
def derive_grid(w, d, count_x=3, count_y=3, origin=(0.0, 0.0)):
    """把可用尺寸切成等开间 × 等进深的轴网。

    返回轴线坐标数组与标准格面积。
    农村自建房经验值：开间 3.0~3.6 m，进深 2.4~3.2 m。
    若算出开间 < 3.0 或进深 < 2.4，说明格数太多，应减少格数或放大体量。
    """
    cw = w / count_x
    cd = d / count_y
    ax = [round(origin[0] + cw * i, 3) for i in range(count_x + 1)]
    ay = [round(origin[1] + cd * i, 3) for i in range(count_y + 1)]
    warn = []
    if cw < 3.0:
        warn.append("开间 %.2f m 偏小（经验值 3.0~3.6），建议减少 X 向格数" % cw)
    if cw > 4.0:
        warn.append("开间 %.2f m 偏大（经验值 3.0~3.6），建议增加 X 向格数" % cw)
    if cd < 2.4:
        warn.append("进深 %.2f m 偏小（经验值 2.4~3.2），建议减少 Y 向格数" % cd)
    if cd > 3.6:
        warn.append("进深 %.2f m 偏大（经验值 2.4~3.2），建议增加 Y 向格数" % cd)
    return {
        "AX": ax, "AY": ay,
        "cell_w": round(cw, 3), "cell_d": round(cd, 3),
        "cell_area": round(cw * cd, 2),
        "total": round(w * d, 2),
        "warn": warn,
    }


# ----------------------------------------------------------------------
# 5. 主流程
# ----------------------------------------------------------------------
def analyze(data):
    points = data["points"]
    order = [p["id"] for p in points]
    local, meta = to_local(points, tuple(data.get("ref_edge", ["J1", "J2"])))
    edges, area = edges_and_area(order, local, meta["bearing_x"])

    out = {
        "local_points": local,
        "meta": meta,
        "edges": edges,
        "area_computed": round(area, 4),
        "bbox": bbox(local),
    }

    stated = data.get("stated_area")
    if stated:
        diff = area - float(stated)
        out["area_check"] = {
            "stated": float(stated),
            "computed": round(area, 4),
            "diff_m2": round(diff, 4),
            "diff_pct": round(diff / float(stated) * 100, 3),
            "ok": abs(diff / float(stated)) <= 0.01,
            "note": ("面积闭合，界址点可信" if abs(diff / float(stated)) <= 0.01
                     else "面积不闭合，禁止出图，先核对原始测绘成果"),
        }

    ec = check_closure(edges, data.get("stated_edges"))
    if ec:
        out["edge_check"] = ec

    out["slant"] = east_west_slant(order, local)

    if data.get("inscribed_rect", True):
        bb = out["bbox"]
        out["max_rect"] = max_inscribed_rect(
            order, local, margin=float(data.get("margin", 0.15)))

    g = data.get("grid")
    if g and out.get("max_rect"):
        r = out["max_rect"]
        out["grid"] = derive_grid(r["w"], r["d"],
                                  int(g.get("count_x", 3)),
                                  int(g.get("count_y", 3)))

    # 合规前置提示
    tips = []
    a = out["area_computed"]
    if a < 80:
        tips.append("用地 %.1f ㎡ 低于宅基地限额下限 80 ㎡，审批需特别说明" % a)
    if a > 120:
        tips.append("用地 %.1f ㎡ 高于宅基地限额上限 120 ㎡，超出部分须单独说明来源" % a)
    out["precheck_tips"] = tips
    return out


SELF_TEST = {
    "points": [
        {"id": "J1", "x": 2690387.024, "y": 39587657.342},
        {"id": "J2", "x": 2690391.172, "y": 39587667.186},
        {"id": "J3", "x": 2690379.683, "y": 39587672.371},
        {"id": "J4", "x": 2690378.289, "y": 39587669.062},
        {"id": "J5", "x": 2690381.598, "y": 39587667.669},
        {"id": "J6", "x": 2690378.721, "y": 39587660.840},
    ],
    "stated_area": 110.00,
    "stated_edges": {"J1-J2": 10.68, "J2-J3": 12.60, "J3-J4": 3.59,
                     "J4-J5": 3.59, "J5-J6": 7.41, "J6-J1": 9.01},
    "margin": 0.15,
    "grid": {"count_x": 3, "count_y": 3},
}


def main():
    argv = sys.argv[1:]

    # 轴网快速推导：python site_geometry.py --grid 9.60 8.40 [nx] [ny]
    if argv and argv[0] == '--grid':
        vals = [float(x) for x in argv[1:]]
        if len(vals) < 2:
            print('用法: --grid <面宽m> <进深m> [X格数] [Y格数]')
            return
        w, d = vals[0], vals[1]
        nx = int(vals[2]) if len(vals) > 2 else 3
        ny = int(vals[3]) if len(vals) > 3 else 3
        print(json.dumps(derive_grid(w, d, nx, ny),
                         ensure_ascii=False, indent=2))
        return

    if argv and argv[0] != '-':
        with open(argv[0], encoding='utf-8') as f:
            data = json.load(f)
    elif argv and argv[0] == '-':
        data = json.load(sys.stdin)
    else:
        data = SELF_TEST
    result = analyze(data)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
