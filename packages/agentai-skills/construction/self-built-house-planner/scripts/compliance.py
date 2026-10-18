# -*- coding: utf-8 -*-
"""
农房规划合规自动校核（Rural House Compliance Check）
====================================================

把「农村自建房规划」必须过的规范条款固化成可执行规则，方案改一次跑一次。
规划阶段能自动判的大部分问题都在这里，避免带着硬伤进报建。

⚠️ 重要前提：**建筑面积上限务必先向乡镇审批窗口核实**。
   本模块默认口径为福建省：三层、每户建筑面积 300 ㎡以内
   （闽政办〔2011〕189 号第三十七条）。若当地另有口径，
   请在调用时传 limit_area / limit_floors 覆盖。

输入（JSON）：
{
  "site_area": 110.0,            // 用地面积（红线内，㎡）
  "floors": 3,                   // 计层数（不含坡屋顶阁楼、架空层）
  "building_area": 282.45,       // 计容建筑面积合计（㎡）
  "footprint": 97.65,            // 建筑基底面积（㎡）
  "floor_height": [4.20, 3.30, 3.30],   // 各层层高（m）
  "total_height": 13.95,         // 室外地面至屋面最高点（m）
  "stairs": [{"clear_width": 1.20, "tread": 0.26, "riser": 0.17}],
  "rooms": [
    {"name": "主卧", "type": "bedroom", "area": 21.70, "net_height": 2.60},
    {"name": "起居厅", "type": "living", "area": 19.04},
    ...
  ],
  "wet_over": [                  // 楼层卫生间正下方的房间类型
    {"wet": "三层主卫", "below": "二层套卫"}
  ],
  "window_floor_ratio": 0.15,    // 窗地比
  "corridor_widths": [3.50, 1.20],   // 过道净宽（入口 / 其他）
  "parapet_height": 1.10,
  "wall_gap_east": 4.20,         // 山墙与相邻建筑间距（m）
  "limits": {                    // 覆盖默认值（可选）
     "limit_floors": 3,
     "limit_area": 300.0,
     "limit_coverage": 0.80
  }
}

输出：{"results": [{"id","item","require","actual","status","note"}], "summary": {...}}
status ∈ {"pass", "fail", "warn", "manual"}   manual = 需人工/现场核定
"""

import json
import sys

DEFAULT_LIMITS = {
    'limit_floors': 3,            # 省级：自建住宅不得超过三层
    'limit_area': 300.0,          # 省级：每户建筑面积控制在 300 ㎡以内
    'limit_coverage': 0.80,       # 农村宅基地建筑覆盖率常规上限
    'min_living_area': 10.0,      # 起居室 ≥10 ㎡
    'min_bedroom_double': 9.0,    # 双人卧室 ≥9 ㎡
    'min_kitchen_area': 6.0,      # 厨房 ≥6.0 ㎡（燃柴宜 ≥10）
    'min_net_height': 2.40,       # 卧室/起居室净高 ≥2.40 m
    'min_corridor_entry': 1.20,   # 入口过道净宽 ≥1.20 m
    'min_corridor_other': 1.00,   # 其他过道净宽 ≥1.00 m
    'min_stair_width': 0.90,      # 梯段净宽（两侧有墙）≥0.90 m
    'min_tread': 0.22,            # 踏步宽 ≥0.22 m
    'max_riser': 0.20,            # 踏步高 ≤0.20 m
    'min_parapet': 1.05,          # 栏杆/女儿墙 ≥1.05 m
    'min_window_floor_ratio': 1 / 7.0,   # 窗地比 ≥1/7
    'min_wall_gap': 4.0,          # 相邻房屋山墙间距 ≥4.0 m
    'max_floor_height_hint': 3.0,  # 层高「一般 3 米左右」——超出仅提示
}


def _mk(rid, item, require, actual, status, note=''):
    return {'id': rid, 'item': item, 'require': require,
            'actual': actual, 'status': status, 'note': note}


def check(data):
    L = dict(DEFAULT_LIMITS)
    L.update(data.get('limits') or {})
    res = []

    # ---- 1. 用地 ----
    sa = data.get('site_area')
    if sa is not None:
        if sa < 80:
            st, nt = 'warn', '低于宅基地限额下限 80 ㎡（福建省土地管理条例）'
        elif sa > 120:
            st, nt = 'warn', '高于宅基地限额上限 120 ㎡，超出部分须单独说明来源'
        else:
            st, nt = 'pass', '宅基地面积在 80~120 ㎡ 限额内'
        res.append(_mk('site', '宅基地面积', '80 ~ 120 ㎡',
                       '%.2f ㎡' % sa, st, nt))

    # ---- 2. 层数 ----
    fl = data.get('floors')
    if fl is not None:
        lim = L['limit_floors']
        st = 'pass' if fl <= lim else 'fail'
        nt = ('省级规定自建住宅不得超过三层；坡屋顶阁楼（起坡点不高于顶层屋面 0.5 m、'
              '坡屋顶高度不高于 2.2 m）与底层架空层（层高 ≤2.2 m）不计层数，'
              '可用于争取休闲与停车空间')
        res.append(_mk('floors', '建筑层数', '≤ %d 层' % lim,
                       '%d 层' % fl, st, nt))

    # ---- 3. 建筑面积 ----
    ba = data.get('building_area')
    if ba is not None:
        lim = L['limit_area']
        st = 'pass' if ba <= lim else 'fail'
        nt = ('距上限余 %.2f ㎡' % (lim - ba)) if ba <= lim else \
             ('超出 %.2f ㎡，必须核减或改为不计容空间（阁楼/架空层）' % (ba - lim))
        res.append(_mk('area', '计容建筑面积', '≤ %.0f ㎡' % lim,
                       '%.2f ㎡' % ba, st, nt))

    # ---- 4. 覆盖率 ----
    fp = data.get('footprint')
    if fp is not None and sa:
        cov = fp / sa
        lim = L['limit_coverage']
        st = 'pass' if cov <= lim + 1e-6 else (
            'warn' if cov <= 0.90 else 'fail')
        nt = '覆盖率超常规上限，须向自然资源部门确认本地执行口径' \
            if cov > lim else ''
        res.append(_mk('coverage', '建筑覆盖率', '≤ %.0f%%' % (lim * 100),
                       '%.1f%%（基底 %.2f ㎡）' % (cov * 100, fp), st, nt))

    # ---- 5. 层高 ----
    fh = data.get('floor_height') or []
    hint = L['max_floor_height_hint']
    bad = [i + 1 for i, h in enumerate(fh) if h > hint + 0.6]
    res.append(_mk('floor_height', '层高',
                   '一般 3 m 左右',
                   ' / '.join('%.2f' % h for h in fh) or '—',
                   'warn' if bad else 'pass',
                   '第 %s 层层高明显偏高，须核实当地是否有硬性层高限制'
                   % ('、'.join(map(str, bad))) if bad else ''))

    # ---- 6. 总高 ----
    th = data.get('total_height')
    if th is not None:
        # 三层 ≤14 m（含坡屋顶）；无架空层 ≤11.8 m（厦门口径，作参考）
        st = 'pass' if th <= 14.0 else 'warn'
        res.append(_mk('total_height', '建筑总高', '≤ 14.0 m（三层含坡屋顶）',
                       '%.2f m' % th, st,
                       '限高须以当地自然资源部门答复为准'))

    # ---- 7. 楼梯 ----
    for i, s in enumerate(data.get('stairs') or [], 1):
        w = s.get('clear_width')
        if w is not None:
            res.append(_mk('stair_w%d' % i, '梯段净宽',
                           '≥ %.2f m' % L['min_stair_width'],
                           '%.2f m' % w,
                           'pass' if w >= L['min_stair_width'] - 1e-6 else 'fail',
                           '两侧有墙时 ≥0.90 m'))
        tr = s.get('tread')
        if tr is not None:
            res.append(_mk('stair_t%d' % i, '踏步宽',
                           '≥ %.2f m' % L['min_tread'], '%.2f m' % tr,
                           'pass' if tr >= L['min_tread'] - 1e-6 else 'fail'))
        ri = s.get('riser')
        if ri is not None:
            res.append(_mk('stair_r%d' % i, '踏步高',
                           '≤ %.2f m' % L['max_riser'], '%.2f m' % ri,
                           'pass' if ri <= L['max_riser'] + 1e-6 else 'fail',
                           '层高越大越要注意踏步高不超标'))

    # ---- 8. 房间尺度 ----
    for r in data.get('rooms') or []:
        t, nm = r.get('type'), r.get('name', '')
        a = r.get('area')
        if t == 'living' and a is not None:
            res.append(_mk('room_living', '起居室面积',
                           '≥ %.1f ㎡' % L['min_living_area'],
                           '%s %.2f ㎡' % (nm, a),
                           'pass' if a >= L['min_living_area'] else 'fail'))
        if t == 'bedroom' and a is not None:
            res.append(_mk('room_bed', '双人卧室面积',
                           '≥ %.1f ㎡' % L['min_bedroom_double'],
                           '%s %.2f ㎡' % (nm, a),
                           'pass' if a >= L['min_bedroom_double'] else 'warn',
                           '单人间可放宽'))
        if t == 'kitchen' and a is not None:
            note = '燃柴灶宜 ≥10 ㎡' if a < 10 else ''
            res.append(_mk('room_kitchen', '厨房面积',
                           '≥ %.1f ㎡' % L['min_kitchen_area'],
                           '%s %.2f ㎡' % (nm, a),
                           'pass' if a >= L['min_kitchen_area'] else 'fail', note))
        nh = r.get('net_height')
        if nh is not None and t in ('bedroom', 'living'):
            res.append(_mk('room_h_%s' % nm, '房间净高',
                           '≥ %.2f m' % L['min_net_height'],
                           '%s %.2f m' % (nm, nh),
                           'pass' if nh >= L['min_net_height'] else 'fail'))

    # ---- 9. 卫生间不得压在卧室/堂屋/厨房/餐厅之上 ----
    for w in data.get('wet_over') or []:
        below = (w.get('below') or '').strip()
        bad = any(k in below for k in ('卧', '堂', '厨', '餐', '厅'))
        res.append(_mk('wet_stack', '楼层卫生间位置',
                       '不得布置在卧室、堂屋、厨房、餐厅正上方',
                       '%s → 下方为 %s' % (w.get('wet'), below or '—'),
                       'fail' if bad else 'pass',
                       '否则必须做同层排水并加隔声，仍不推荐'))

    # ---- 10. 窗地比 ----
    wr = data.get('window_floor_ratio')
    if wr is not None:
        res.append(_mk('window', '窗地面积比',
                       '≥ 1/7（约 %.3f）' % L['min_window_floor_ratio'],
                       '%.3f' % wr,
                       'pass' if wr >= L['min_window_floor_ratio'] - 1e-6 else 'warn'))

    # ---- 11. 过道净宽 ----
    for i, cw in enumerate(data.get('corridor_widths') or []):
        lim = L['min_corridor_entry'] if i == 0 else L['min_corridor_other']
        nm = '入口过道' if i == 0 else '其他过道'
        res.append(_mk('corridor%d' % i, nm + '净宽',
                       '≥ %.2f m' % lim, '%.2f m' % cw,
                       'pass' if cw >= lim - 1e-6 else 'fail'))

    # ---- 12. 栏杆 / 女儿墙 ----
    ph = data.get('parapet_height')
    if ph is not None:
        res.append(_mk('parapet', '栏杆或女儿墙高度',
                       '≥ %.2f m' % L['min_parapet'], '%.2f m' % ph,
                       'pass' if ph >= L['min_parapet'] - 1e-6 else 'fail',
                       '杆件净距 ≤0.11 m'))

    # ---- 13. 山墙间距 / 防火间距 ----
    wg = data.get('wall_gap_east')
    if wg is not None:
        res.append(_mk('wall_gap', '山墙与相邻建筑间距',
                       '≥ %.1f m（相邻）/ 防火间距一二级 ≥4 m、三四级 ≥6 m'
                       % L['min_wall_gap'],
                       '%.2f m' % wg,
                       'pass' if wg >= L['min_wall_gap'] - 1e-6 else 'warn',
                       '贴邻时必须做不燃实体墙、不开窗'))

    # ---- 14. 需人工核定的项（固定提示，不参与打分） ----
    for rid, item, nt in [
        ('manual_area_limit', '建筑面积上限口径',
         '省级为三层/300 ㎡以内；务必向乡镇审批窗口核实本地执行值并取得书面依据'),
        ('manual_height_limit', '建筑限高',
         '须向自然资源部门核实（常见 12 m 或 15 m）'),
        ('manual_flood_level', '小河洪水位',
         '一层室内地坪标高完全取决于实测洪水位；测一次不贵，测错了很贵'),
        ('manual_land_outside', '红线外用地使用关系',
         '红线外部分（如前院）须与村集体、邻户确认并取得书面意见'),
        ('manual_designer', '设计资质',
         '施工图须由有资质单位或注册执业人员出具，规划案不能直接用于报建'),
        ('manual_soil', '地基与基础',
         '须有岩土勘察或经验开挖确认；临河地块尤须注意冲刷与软弱层'),
    ]:
        res.append(_mk(rid, item, '须人工核定', '待办', 'manual', nt))

    n_fail = sum(1 for r in res if r['status'] == 'fail')
    n_warn = sum(1 for r in res if r['status'] == 'warn')
    n_pass = sum(1 for r in res if r['status'] == 'pass')
    n_manual = sum(1 for r in res if r['status'] == 'manual')
    return {
        'results': res,
        'summary': {
            'total': len(res), 'pass': n_pass, 'fail': n_fail,
            'warn': n_warn, 'manual': n_manual,
            'verdict': ('不通过：%d 项硬性不合规，须先整改' % n_fail) if n_fail
                       else ('通过（%d 项需人工复核）' % n_manual),
        },
    }


def main():
    data = json.load(sys.stdin)
    print(json.dumps(check(data), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
