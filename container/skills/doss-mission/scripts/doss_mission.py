#!/usr/bin/env python3
"""
DOSS 任务管理脚本

子命令：
  list      - 分页查询飞行任务列表
  detail    - 查询任务详情
  apply     - 查询活动列表
  create    - 创建立即任务（attribute=3）
  report    - 查询飞行报告
  events    - 查询任务识别事件

用法示例：
  python3 doss_mission.py list
  python3 doss_mission.py list --status 2 --date-start "2026-03-01 00:00:00" --date-end "2026-03-12 23:59:59"
  python3 doss_mission.py detail --id <task_id>
  python3 doss_mission.py apply
  python3 doss_mission.py create --route-id <airRouteId> --type 1
  python3 doss_mission.py report
  python3 doss_mission.py events --task-id <task_id>
"""

import sys
import json
import argparse
import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("[错误] 缺少 requests 库，请运行: pip install requests")
    sys.exit(1)

# ─── 配置常量 ────────────────────────────────────────────────────────────────
BASE_URL = "https://doss.xmrbi.com/xmrbi-onecas"
SESSION_FILE = Path.home() / ".claude" / "doss_session.json"

# 任务状态枚举（附录一）
TASK_STATUS_MAP = {
    "0": "未开始",
    "1": "执行中",
    "2": "已完成",
    "3": "启动失败",
    "4": "部分执行",
    "5": "已取消",
}

# 活动任务性质
APPLY_ATTR_MAP = {"1": "频率性任务", "2": "临时性任务", "3": "立即任务"}

# 活动类型
APPLY_TYPE_MAP = {"1": "巡查任务", "2": "全景任务", "3": "倾斜任务", "4": "正射任务", "5": "应急任务"}


def load_token() -> str:
    """读取缓存 Token"""
    if not SESSION_FILE.exists():
        print("[错误] 未找到 Token 缓存，请先运行 doss-auth 登录")
        sys.exit(1)
    session = json.loads(SESSION_FILE.read_text())
    token = session.get("token", "")
    if not token:
        print("[错误] Token 为空，请重新登录（doss-auth）")
        sys.exit(1)
    # 过期提示
    saved_at = datetime.datetime.fromisoformat(session.get("saved_at", "2000-01-01"))
    expires_in = session.get("expires_in", 86400)
    if (datetime.datetime.now() - saved_at).total_seconds() > expires_in:
        print("[警告] Token 已过期，建议重新登录（doss-auth）")
    return token


def get_headers(token: str) -> dict:
    return {"Authorization": token, "Content-Type": "application/json"}


def get_val(d: dict, key: str, default: str = "—") -> str:
    v = d.get(key)
    return str(v) if v is not None else default


# ─── 子命令：list ─────────────────────────────────────────────────────────────
def cmd_list(args, token: str):
    """分页查询飞行任务列表"""
    url = f"{BASE_URL}/uav/flightTask/list"
    params = {
        "pageNum": args.page,
        "pageSize": args.size,
        "basicQueryFlag": "true",
    }
    if args.status:
        params["statusList"] = args.status
    if args.date_start:
        params["beginAtStart"] = args.date_start
    if args.date_end:
        params["beginAtEnd"] = args.date_end
    if args.route_name:
        params["airRoute.name"] = args.route_name
    if args.drone_name:
        params["aircraft.name"] = args.drone_name

    try:
        resp = requests.get(url, headers=get_headers(token), params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        # 真实响应结构：{page: {count: N, list: [...]}}
        page_obj = data.get("page") or data.get("data", {})
        records = page_obj.get("list") or page_obj.get("records") or []
        total = page_obj.get("count") or page_obj.get("total") or len(records)

        print(f"\n飞行任务列表（第{args.page}页，共 {total} 条）\n{'─'*60}")
        if not records:
            print("  （无数据）")
            return

        for t in records:
            task_id = get_val(t, "id")
            status_code = get_val(t, "status")
            status = TASK_STATUS_MAP.get(status_code, f"未知({status_code})")
            begin = get_val(t, "beginAt")
            end = get_val(t, "endAt")
            route = (t.get("airRoute") or {}).get("name", "—")
            drone = (t.get("aircraft") or {}).get("name", "—")
            dock = (t.get("dock") or {}).get("name", "—")
            distance = get_val(t, "flightDistance")
            alarm_cnt = get_val(t, "alarmCount")

            print(f"  ID: {task_id}")
            print(f"  状态: {status}  开始: {begin}  结束: {end}")
            print(f"  航线: {route}  无人机: {drone}  机场: {dock}")
            print(f"  飞行距离: {distance}m  告警事件: {alarm_cnt} 条")
            print()

        print(f"{'─'*60}\n共 {total} 条，当前显示第 {args.page} 页")

    except requests.RequestException as e:
        print(f"[错误] 查询任务列表失败：{e}")


# ─── 子命令：detail ───────────────────────────────────────────────────────────
def cmd_detail(args, token: str):
    """查询任务详情"""
    if not args.id:
        print("[错误] 请用 --id 指定任务 ID")
        sys.exit(1)

    url = f"{BASE_URL}/uav/flightTask/queryById"
    params = {"id": args.id}

    try:
        resp = requests.get(url, headers=get_headers(token), params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        # 真实响应字段为 flightTask，而非 data
        t = data.get("flightTask") or data.get("data") or {}

        if not t:
            print(f"[错误] 未找到任务 ID: {args.id}")
            return

        status_code = get_val(t, "status")
        status = TASK_STATUS_MAP.get(status_code, f"未知({status_code})")
        route = (t.get("airRoute") or {}).get("name", "—")
        # aircraft 用 deviceName，dock 用 deviceName
        drone = (t.get("aircraft") or {}).get("deviceName") or (t.get("aircraft") or {}).get("name", "—")
        dock = (t.get("dock") or {}).get("deviceName") or (t.get("dock") or {}).get("name", "—")
        waypoints = f"{get_val(t, 'currentWaypointIndex')}/{get_val(t, 'totalWaypoints')}"

        print(f"\n任务详情 [{args.id}]\n{'─'*60}")
        print(f"  状态:     {status}")
        print(f"  预计开始: {get_val(t, 'predictBeginAt')}  实际开始: {get_val(t, 'beginAt')}")
        print(f"  预计结束: {get_val(t, 'predictEndAt')}  实际结束: {get_val(t, 'endAt')}")
        print(f"  航线:     {route}")
        print(f"  无人机:   {drone}  机场: {dock}")
        print(f"  航点进度: {waypoints}  飞行距离: {get_val(t, 'flightDistance')}m")
        print(f"  告警事件: {get_val(t, 'alarmCount')} 条")
        if t.get("errorMessage"):
            print(f"  错误信息: {t['errorMessage']}")
        if t.get("exceptionReason"):
            print(f"  异常原因: {t['exceptionReason']}")

        # 媒体资源
        pic_urls = t.get("picUrls") or []
        video_urls = t.get("videoUrls") or []
        print(f"\n  媒体资源: 图片 {len(pic_urls)} 张  视频 {len(video_urls)} 段")

        report_id = get_val(t, "reportAnnexId")
        if report_id != "—":
            print(f"  飞行报告附件ID: {report_id}")

    except requests.RequestException as e:
        print(f"[错误] 查询任务详情失败：{e}")


# ─── 子命令：apply ────────────────────────────────────────────────────────────
def cmd_apply(args, token: str):
    """查询活动列表"""
    url = f"{BASE_URL}/uav/taskApply/list"
    params = {"pageNum": args.page, "pageSize": args.size}
    if args.attr:
        params["attribute"] = args.attr
    if args.date_start:
        params["startDate"] = args.date_start[:10]  # 只取日期部分
    if args.date_end:
        params["endDate"] = args.date_end[:10]

    try:
        resp = requests.get(url, headers=get_headers(token), params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        page_obj = data.get("page") or data.get("data", {})
        records = page_obj.get("list") or page_obj.get("records") or []
        total = page_obj.get("count") or page_obj.get("total") or len(records)

        print(f"\n活动列表（共 {total} 条）\n{'─'*60}")
        if not records:
            print("  （无数据）")
            return

        for a in records:
            aid = get_val(a, "id")
            code = get_val(a, "code")
            attr = APPLY_ATTR_MAP.get(get_val(a, "attribute"), "—")
            atype = APPLY_TYPE_MAP.get(get_val(a, "type"), "—")
            status = get_val(a, "status")
            start = get_val(a, "startDate")
            end = get_val(a, "endDate")
            exec_time = get_val(a, "executeTime")

            print(f"  ID: {aid}  单号: {code}")
            print(f"  性质: {attr}  类型: {atype}  状态: {status}")
            print(f"  计划: {start} ~ {end}  执行时间: {exec_time}")
            print()

    except requests.RequestException as e:
        print(f"[错误] 查询活动列表失败：{e}")


# ─── 子命令：create ───────────────────────────────────────────────────────────
def cmd_create(args, token: str):
    """创建立即任务（attribute=3）"""
    if not args.route_id:
        print("[错误] 请用 --route-id 指定航线 ID")
        sys.exit(1)

    url = f"{BASE_URL}/uav/taskApply/createApply"
    payload = {
        "attribute": "3",          # 立即任务
        "type": str(args.type),    # 活动类型
        "airRouteId": args.route_id,
    }

    print(f"\n即将创建立即任务：")
    print(f"  航线ID: {args.route_id}")
    print(f"  任务类型: {APPLY_TYPE_MAP.get(str(args.type), '未知')}")
    print()

    try:
        resp = requests.post(url, headers=get_headers(token), json=payload, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        result = data.get("data") or {}

        task_id = get_val(result, "id")
        code = get_val(result, "code")
        status = get_val(result, "status")

        print(f"✅ 立即任务创建成功！")
        print(f"  活动ID:   {task_id}")
        print(f"  活动单号: {code}")
        print(f"  状态:     {status}")

    except requests.RequestException as e:
        print(f"[错误] 创建任务失败：{e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"  响应：{e.response.text[:200]}")


# ─── 子命令：report ───────────────────────────────────────────────────────────
def cmd_report(args, token: str):
    """查询飞行报告列表"""
    url = f"{BASE_URL}/uav/flightReport/list"
    params = {"pageNum": args.page, "pageSize": args.size}
    if args.task_name:
        params["taskName"] = args.task_name
    if args.drone_name:
        params["aircraftName"] = args.drone_name
    if args.route_name:
        params["airRouteName"] = args.route_name

    try:
        resp = requests.get(url, headers=get_headers(token), params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        page_obj = data.get("page") or data.get("data", {})
        records = page_obj.get("list") or page_obj.get("records") or []
        total = page_obj.get("count") or page_obj.get("total") or len(records)

        print(f"\n飞行报告列表（共 {total} 条）\n{'─'*60}")
        if not records:
            print("  （无数据）")
            return

        for r in records:
            rid = get_val(r, "id")
            task_name = get_val(r, "taskName")
            route_name = get_val(r, "airRouteName")
            drone_name = get_val(r, "aircraftName")
            create_time = get_val(r, "createTime")

            print(f"  报告ID: {rid}")
            print(f"  任务: {task_name}  航线: {route_name}  无人机: {drone_name}")
            print(f"  生成时间: {create_time}")
            print()

    except requests.RequestException as e:
        print(f"[错误] 查询飞行报告失败：{e}")


# ─── 子命令：events ───────────────────────────────────────────────────────────
def cmd_events(args, token: str):
    """查询任务识别事件"""
    if not args.task_id:
        print("[错误] 请用 --task-id 指定任务 ID")
        sys.exit(1)

    url = f"{BASE_URL}/uav/alarm/list"
    params = {
        "flightTask.id": args.task_id,
        "pageNum": args.page,
        "pageSize": args.size,
    }
    if args.unprocessed:
        params["alarmProcessState"] = "0"

    try:
        resp = requests.get(url, headers=get_headers(token), params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        page_obj = data.get("page") or data.get("data", {})
        records = page_obj.get("list") or page_obj.get("records") or []
        total = page_obj.get("count") or page_obj.get("total") or len(records)

        process_map = {"0": "未处理", "1": "已处理", "2": "误报"}
        identify_map = {"1": "边端识别", "2": "云端识别", "3": "对比检测"}

        print(f"\n识别事件列表 [任务:{args.task_id}]（共 {total} 条）\n{'─'*60}")
        if not records:
            print("  （无数据）")
            return

        for e in records:
            eid = get_val(e, "id")
            model = get_val(e, "model")
            labels = get_val(e, "labels")
            lnglat = get_val(e, "lnglat")
            event_time = get_val(e, "eventTime")
            process_state = process_map.get(get_val(e, "alarmProcessState"), "—")
            identify = identify_map.get(get_val(e, "alarmIdentifyMethod"), "—")

            print(f"  事件ID: {eid}  时间: {event_time}")
            print(f"  模型: {model}  标签: {labels}")
            print(f"  位置: {lnglat}  识别方式: {identify}  处理状态: {process_state}")
            print()

    except requests.RequestException as e:
        print(f"[错误] 查询识别事件失败：{e}")


# ─── 主入口 ───────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="DOSS 任务管理")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # list
    p_list = sub.add_parser("list", help="查询飞行任务列表")
    p_list.add_argument("--status", help="状态码（0未开始 1执行中 2已完成 3失败）")
    p_list.add_argument("--date-start", help="开始时间（2026-03-01 00:00:00）")
    p_list.add_argument("--date-end", help="结束时间（2026-03-12 23:59:59）")
    p_list.add_argument("--route-name", help="航线名称关键词")
    p_list.add_argument("--drone-name", help="无人机名称关键词")
    p_list.add_argument("--page", type=int, default=1)
    p_list.add_argument("--size", type=int, default=10)

    # detail
    p_detail = sub.add_parser("detail", help="查询任务详情")
    p_detail.add_argument("--id", required=True, help="任务 ID")

    # apply
    p_apply = sub.add_parser("apply", help="查询活动列表")
    p_apply.add_argument("--attr", help="任务性质（1频率 2临时 3立即）")
    p_apply.add_argument("--date-start", help="开始日期（2026-03-01）")
    p_apply.add_argument("--date-end", help="结束日期（2026-03-12）")
    p_apply.add_argument("--page", type=int, default=1)
    p_apply.add_argument("--size", type=int, default=10)

    # create
    p_create = sub.add_parser("create", help="创建立即任务")
    p_create.add_argument("--route-id", required=True, help="航线 ID")
    p_create.add_argument("--type", type=int, default=1, choices=[1, 2, 3, 4],
                          help="任务类型（1巡查 2全景 3倾斜 4正射，默认1）")

    # report
    p_report = sub.add_parser("report", help="查询飞行报告")
    p_report.add_argument("--task-name", help="任务名称关键词")
    p_report.add_argument("--drone-name", help="无人机名称")
    p_report.add_argument("--route-name", help="航线名称")
    p_report.add_argument("--page", type=int, default=1)
    p_report.add_argument("--size", type=int, default=10)

    # events
    p_events = sub.add_parser("events", help="查询任务识别事件")
    p_events.add_argument("--task-id", required=True, help="飞行任务 ID")
    p_events.add_argument("--unprocessed", action="store_true", help="只显示未处理事件")
    p_events.add_argument("--page", type=int, default=1)
    p_events.add_argument("--size", type=int, default=20)

    args = parser.parse_args()
    token = load_token()

    dispatch = {
        "list": cmd_list,
        "detail": cmd_detail,
        "apply": cmd_apply,
        "create": cmd_create,
        "report": cmd_report,
        "events": cmd_events,
    }
    dispatch[args.cmd](args, token)


if __name__ == "__main__":
    main()
