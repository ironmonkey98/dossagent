#!/usr/bin/env python3
"""
DOSS 航线与项目查询脚本 - 覆盖 API 6.1~6.5

子命令：
  projects   查询项目列表
  docks      查询项目关联机场
  routes     查询航线列表
  detail     查询航线详情（含航点）
  waypoints  查询航点数据

用法：
  python3 doss_route.py projects [--name 巡检] [--page 1] [--size 20]
  python3 doss_route.py docks --project-id <id> [--name 软三]
  python3 doss_route.py routes [--name 沈海] [--project-id <id>] [--page 1]
  python3 doss_route.py detail --id <route_id>
  python3 doss_route.py waypoints --route-id <route_id> [--page 1]
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

BASE_URL = "https://doss.xmrbi.com/xmrbi-onecas"
SESSION_FILE = Path.home() / ".claude" / "doss_session.json"


def load_token() -> str:
    if not SESSION_FILE.exists():
        print("[错误] 未找到 Token 缓存，请先运行 doss-auth 登录")
        sys.exit(1)
    session = json.loads(SESSION_FILE.read_text())
    token = session.get("token", "")
    if not token:
        print("[错误] Token 为空，请重新登录（doss-auth）")
        sys.exit(1)
    saved_at = datetime.datetime.fromisoformat(session.get("saved_at", "2000-01-01"))
    expires_in = session.get("expires_in", 86400)
    if (datetime.datetime.now() - saved_at).total_seconds() > expires_in:
        print("[警告] Token 可能已过期，建议重新运行 doss-auth")
    return token


def get(token: str, path: str, params: dict) -> dict:
    """GET 请求，token 放在 Authorization 头"""
    url = f"{BASE_URL}{path}"
    try:
        resp = requests.get(url, headers={"Authorization": token}, params=params, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print(f"[错误] 请求失败：{e}")
        sys.exit(1)


def cmd_projects(token: str, name: str, page: int, size: int):
    """6.1 查询项目列表"""
    params = {"pageNo": page, "pageSize": size}
    if name:
        params["name"] = name
    data = get(token, "/uav/projectInfo/list", params)
    page_data = data.get("page", {})
    total = page_data.get("count", 0)
    items = page_data.get("list", [])
    print(f"\n═══ 项目列表 (共 {total} 个，当前第 {page} 页) ═══")
    if not items:
        print("  （无数据）")
        return
    for item in items:
        print(f"  项目: {item.get('name', '—')}")
        print(f"  ID: {item.get('id', '—')}")
        intro = item.get("introduction", "")
        if intro:
            print(f"  描述: {intro}")
        print(f"  创建时间: {item.get('createDate', '—')}")
        print()


def cmd_docks(token: str, project_id: str, name: str, page: int, size: int):
    """6.2 查询项目关联机场"""
    params = {"pageNo": page, "pageSize": size, "projectId": project_id}
    if name:
        params["deviceName"] = name
    data = get(token, "/uav/projectInfo/dockList", params)
    page_data = data.get("page", {})
    total = page_data.get("count", 0)
    items = page_data.get("list", [])
    print(f"\n═══ 项目关联机场 (共 {total} 台) ═══")
    if not items:
        print("  （无数据）")
        return
    for item in items:
        online = "在线" if item.get("online") == "1" else "离线"
        ctrl = "可控" if item.get("controllable") == "1" else "不可控"
        print(f"  机场: {item.get('deviceName', '—')}  [{item.get('deviceCode', '—')}]")
        print(f"  状态: {online}  {ctrl}")
        print()


def cmd_routes(token: str, name: str, project_id: str, page: int, size: int):
    """6.4 查询航线列表"""
    params = {
        "pageNo": page,
        "pageSize": size,
        "types": "5",          # 固定：无人机机场航线
        "queryPlacemark": False,  # 列表不含航点，节省流量
        "versionFilter": True,
    }
    if name:
        params["name"] = name
    if project_id:
        params["projectId"] = project_id
    data = get(token, "/uav/airRoute/list", params)
    page_data = data.get("page", {})
    total = page_data.get("count", 0)
    items = page_data.get("list", [])
    print(f"\n═══ 航线列表 (共 {total} 条，当前第 {page} 页) ═══")
    if not items:
        print("  （无数据）")
        return
    for item in items:
        dist = item.get("distance", "—")
        height = item.get("globalHeight", "—")
        speed = item.get("globalSpeed", "—")
        predict = item.get("predictTime", "—")
        wpts = item.get("totalWaypoints", "—")
        lat = item.get("latitude", "—")
        lng = item.get("longitude", "—")
        print(f"  航线: {item.get('name', '—')}")
        print(f"  ID: {item.get('id', '—')}")
        print(f"  项目: {item.get('projectName', '—')}")
        print(f"  距离: {dist}m  高度: {height}m  速度: {speed}m/s  预计: {predict}s  航点数: {wpts}")
        if lat != "—" and lng != "—":
            print(f"  起点: {lat}, {lng}")
        print()


def cmd_detail(token: str, route_id: str):
    """6.3 查询航线详情（含航点）"""
    data = get(token, "/uav/airRoute/queryById", {"id": route_id})
    route = data.get("airRoute", {})
    if not route:
        print("[错误] 未找到航线数据")
        return
    print(f"\n═══ 航线详情 ═══")
    print(f"  名称: {route.get('name', '—')}")
    print(f"  ID: {route.get('id', '—')}")
    print(f"  项目: {route.get('projectName', '—')}  (ID: {route.get('projectId', '—')})")
    print(f"  距离: {route.get('distance', '—')}m")
    print(f"  全局高度: {route.get('globalHeight', '—')}m")
    print(f"  全局速度: {route.get('globalSpeed', '—')}m/s")
    print(f"  预计时长: {route.get('predictTime', '—')}s")
    print(f"  航点总数: {route.get('totalWaypoints', '—')}")
    print(f"  创建时间: {route.get('createDate', '—')}")
    print()
    placemarks = route.get("airRoutePlacemarks", [])
    if placemarks:
        print(f"  ─── 航点列表 ({len(placemarks)} 个) ───")
        for pm in placemarks:
            idx = pm.get("indexNo", "—")
            lat = pm.get("latitude", "—")
            lng = pm.get("longitude", "—")
            h = pm.get("height", "—")
            spd = pm.get("waypointSpeed", "—")
            dist = pm.get("direction", "")
            dist_str = f"  距上一点: {dist}m" if dist else ""
            print(f"  [{idx}] lat={lat} lng={lng} h={h}m spd={spd}m/s{dist_str}")


def cmd_waypoints(token: str, route_id: str, page: int, size: int):
    """6.5 查询航点数据"""
    params = {"pageNo": page, "pageSize": size, "airRoute": route_id}
    data = get(token, "/uav/airRoutePlacemark/list", params)
    page_data = data.get("page", {})
    total = page_data.get("count", 0)
    items = page_data.get("list", [])
    print(f"\n═══ 航点数据 (共 {total} 个，当前第 {page} 页) ═══")
    if not items:
        print("  （无数据）")
        return
    for pm in items:
        idx = pm.get("indexNo", "—")
        lat = pm.get("latitude", "—")
        lng = pm.get("longitude", "—")
        h = pm.get("height", "—")
        spd = pm.get("waypointSpeed", "—")
        dist = pm.get("direction", "")
        dist_str = f"  距上一点: {dist}m" if dist else ""
        print(f"  [{idx}] lat={lat} lng={lng} h={h}m spd={spd}m/s{dist_str}")


def main():
    parser = argparse.ArgumentParser(description="DOSS 航线与项目查询")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # projects
    p_proj = sub.add_parser("projects", help="查询项目列表")
    p_proj.add_argument("--name", default="", help="项目名称关键词")
    p_proj.add_argument("--page", type=int, default=1)
    p_proj.add_argument("--size", type=int, default=20)

    # docks
    p_docks = sub.add_parser("docks", help="查询项目关联机场")
    p_docks.add_argument("--project-id", required=True, help="项目 ID")
    p_docks.add_argument("--name", default="", help="机场名称关键词")
    p_docks.add_argument("--page", type=int, default=1)
    p_docks.add_argument("--size", type=int, default=20)

    # routes
    p_routes = sub.add_parser("routes", help="查询航线列表")
    p_routes.add_argument("--name", default="", help="航线名称关键词")
    p_routes.add_argument("--project-id", default="", help="按项目过滤")
    p_routes.add_argument("--page", type=int, default=1)
    p_routes.add_argument("--size", type=int, default=20)

    # detail
    p_detail = sub.add_parser("detail", help="查询航线详情（含航点）")
    p_detail.add_argument("--id", required=True, help="航线 ID")

    # waypoints
    p_wpts = sub.add_parser("waypoints", help="查询航点数据")
    p_wpts.add_argument("--route-id", required=True, help="航线 ID")
    p_wpts.add_argument("--page", type=int, default=1)
    p_wpts.add_argument("--size", type=int, default=50)

    args = parser.parse_args()
    token = load_token()

    if args.cmd == "projects":
        cmd_projects(token, args.name, args.page, args.size)
    elif args.cmd == "docks":
        cmd_docks(token, args.project_id, args.name, args.page, args.size)
    elif args.cmd == "routes":
        cmd_routes(token, args.name, args.project_id, args.page, args.size)
    elif args.cmd == "detail":
        cmd_detail(token, args.id)
    elif args.cmd == "waypoints":
        cmd_waypoints(token, args.route_id, args.page, args.size)


if __name__ == "__main__":
    main()
