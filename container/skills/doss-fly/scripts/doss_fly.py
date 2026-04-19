#!/usr/bin/env python3
"""
DOSS 飞行控制脚本

子命令：
  takeoff   - 一键起飞（飞向目标点）
  flyto     - 飞向目标点（已在空中）
  update    - 更新目标点（飞行中途修改目标）
  stop      - 停止飞向目标点
  home      - 一键返航
  estop     - 飞行器急停（紧急情况）
  grab      - 抢夺飞行控制权
  drc       - 进入指令飞行模式（DRC）

安全设计：
  - estop / grab 操作需二次确认（--confirm 标志）
  - 所有写操作打印操作摘要后执行

用法示例：
  python3 doss_fly.py takeoff --dock DOCK001 --lon 117.943 --lat 24.557 --height 50
  python3 doss_fly.py flyto   --dock DOCK001 --lon 117.943 --lat 24.557 --height 80
  python3 doss_fly.py update  --dock DOCK001 --lon 117.950 --lat 24.560 --height 80
  python3 doss_fly.py stop    --dock DOCK001
  python3 doss_fly.py home    --dock DOCK001
  python3 doss_fly.py estop   --dock DOCK001 --confirm
  python3 doss_fly.py grab    --dock DOCK001 --confirm
  python3 doss_fly.py drc     --dock DOCK001 --confirm
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
BASE_URL = "https://doss.xmrbi.com/xmrbi-onecas/uav/cockpit"
SESSION_FILE = Path.home() / ".claude" / "doss_session.json"

# 需要二次确认的高危操作
DANGEROUS_CMDS = {"estop", "grab", "drc"}


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
    saved_at = datetime.datetime.fromisoformat(session.get("saved_at", "2000-01-01"))
    if (datetime.datetime.now() - saved_at).total_seconds() > session.get("expires_in", 86400):
        print("[警告] Token 已过期，建议重新登录（doss-auth）")
    return token


def get_headers(token: str) -> dict:
    return {"Authorization": token, "Content-Type": "application/json"}


def cockpit_post(token: str, dock_code: str, endpoint: str, payload: dict = None) -> dict:
    """向飞控路径发送 POST 请求"""
    url = f"{BASE_URL}/{dock_code}/{endpoint}"
    try:
        resp = requests.post(
            url,
            headers=get_headers(token),
            json=payload or {},
            timeout=15
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print(f"[错误] 请求失败 [{endpoint}]：{e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"  响应：{e.response.text[:300]}")
        sys.exit(1)


def print_result(data: dict, action: str):
    """统一输出响应结果"""
    code = data.get("code") or data.get("status") or "—"
    msg = data.get("msg") or data.get("message") or data.get("data") or "—"
    if str(code) in ("200", "0", "success", "true"):
        print(f"✅ {action} 指令已下发成功")
    else:
        print(f"⚠️  {action} 响应码: {code}，信息: {msg}")
    if isinstance(data.get("data"), dict):
        print(f"   详情: {json.dumps(data['data'], ensure_ascii=False)}")


# ─── 子命令实现 ───────────────────────────────────────────────────────────────

def cmd_takeoff(args, token: str):
    """一键起飞：飞向目标点"""
    payload = {
        "longitude": args.lon,
        "latitude": args.lat,
        "height": args.height,
        "rthHeight": args.rth_height,
        "takeoffHeight": args.takeoff_height,
    }
    if args.task_uuid:
        payload["taskUuid"] = args.task_uuid

    print(f"\n一键起飞指令")
    print(f"  机场:     {args.dock}")
    print(f"  目标点:   经度={args.lon}  纬度={args.lat}  高度={args.height}m")
    print(f"  返航高度: {args.rth_height}m  起飞高度: {args.takeoff_height}m")
    print()

    data = cockpit_post(token, args.dock, "takeoffToPoint", payload)
    print_result(data, "一键起飞")


def cmd_flyto(args, token: str):
    """飞向目标点（已在空中时使用）"""
    payload = {
        "longitude": args.lon,
        "latitude": args.lat,
        "height": args.height,
    }

    print(f"\n飞向目标点指令")
    print(f"  机场:   {args.dock}")
    print(f"  目标:   经度={args.lon}  纬度={args.lat}  高度={args.height}m")
    print()

    data = cockpit_post(token, args.dock, "flyToPoint", payload)
    print_result(data, "飞向目标点")


def cmd_update(args, token: str):
    """更新飞行目标点（飞行途中修改目标）"""
    payload = {
        "longitude": args.lon,
        "latitude": args.lat,
        "height": args.height,
    }

    print(f"\n更新目标点指令")
    print(f"  机场:     {args.dock}")
    print(f"  新目标:   经度={args.lon}  纬度={args.lat}  高度={args.height}m")
    print()

    data = cockpit_post(token, args.dock, "flyToPointUpdate", payload)
    print_result(data, "更新目标点")


def cmd_stop(args, token: str):
    """停止飞向目标点"""
    print(f"\n停止飞向目标点")
    print(f"  机场: {args.dock}\n")

    data = cockpit_post(token, args.dock, "flyToPointStop")
    print_result(data, "停止飞行")


def cmd_home(args, token: str):
    """一键返航"""
    print(f"\n一键返航指令")
    print(f"  机场: {args.dock}\n")

    data = cockpit_post(token, args.dock, "returnHome")
    print_result(data, "一键返航")


def cmd_estop(args, token: str):
    """飞行器急停 ⚠️ 高危操作"""
    if not args.confirm:
        print("⚠️  危险操作！急停会立即中断所有飞行指令。")
        print("   请添加 --confirm 参数确认执行。")
        sys.exit(0)

    print(f"\n⚠️  执行急停指令")
    print(f"  机场: {args.dock}\n")

    data = cockpit_post(token, args.dock, "droneEmergencyStop")
    print_result(data, "急停")


def cmd_grab(args, token: str):
    """抢夺飞行控制权 ⚠️ 高危操作"""
    if not args.confirm:
        print("⚠️  危险操作！抢夺控制权会中断其他用户的飞行控制。")
        print("   请添加 --confirm 参数确认执行。")
        sys.exit(0)

    print(f"\n⚠️  抢夺飞行控制权")
    print(f"  机场: {args.dock}\n")

    data = cockpit_post(token, args.dock, "flightAuthorityGrab")
    print_result(data, "抢夺飞行控制权")


def cmd_drc(args, token: str):
    """进入指令飞行模式（DRC）⚠️ 高危操作"""
    if not args.confirm:
        print("⚠️  危险操作！进入 DRC 模式后将切换为手动指令控制。")
        print("   请添加 --confirm 参数确认执行。")
        sys.exit(0)

    print(f"\n⚠️  进入 DRC 指令飞行模式")
    print(f"  机场: {args.dock}\n")

    data = cockpit_post(token, args.dock, "drcModeEnter")
    print_result(data, "进入 DRC 模式")


# ─── 主入口 ───────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="DOSS 飞行控制")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # takeoff
    p = sub.add_parser("takeoff", help="一键起飞")
    p.add_argument("--dock", required=True, help="机场编号（dockCode）")
    p.add_argument("--lon", type=float, required=True, help="目标经度")
    p.add_argument("--lat", type=float, required=True, help="目标纬度")
    p.add_argument("--height", type=float, required=True, help="目标高度（m）")
    p.add_argument("--rth-height", type=float, default=100.0, help="返航高度（m，默认100）")
    p.add_argument("--takeoff-height", type=float, default=30.0, help="起飞高度（m，默认30）")
    p.add_argument("--task-uuid", help="关联任务ID（可选）")

    # flyto
    p = sub.add_parser("flyto", help="飞向目标点（已在空中）")
    p.add_argument("--dock", required=True, help="机场编号")
    p.add_argument("--lon", type=float, required=True, help="目标经度")
    p.add_argument("--lat", type=float, required=True, help="目标纬度")
    p.add_argument("--height", type=float, required=True, help="目标高度（m）")

    # update
    p = sub.add_parser("update", help="更新飞行目标点")
    p.add_argument("--dock", required=True, help="机场编号")
    p.add_argument("--lon", type=float, required=True, help="新目标经度")
    p.add_argument("--lat", type=float, required=True, help="新目标纬度")
    p.add_argument("--height", type=float, required=True, help="新目标高度（m）")

    # stop
    p = sub.add_parser("stop", help="停止飞向目标点")
    p.add_argument("--dock", required=True, help="机场编号")

    # home
    p = sub.add_parser("home", help="一键返航")
    p.add_argument("--dock", required=True, help="机场编号")

    # estop — 急停
    p = sub.add_parser("estop", help="飞行器急停 ⚠️ 高危")
    p.add_argument("--dock", required=True, help="机场编号")
    p.add_argument("--confirm", action="store_true", help="二次确认（必须添加）")

    # grab — 抢夺控制权
    p = sub.add_parser("grab", help="抢夺飞行控制权 ⚠️ 高危")
    p.add_argument("--dock", required=True, help="机场编号")
    p.add_argument("--confirm", action="store_true", help="二次确认（必须添加）")

    # drc — 指令飞行模式
    p = sub.add_parser("drc", help="进入指令飞行模式 ⚠️ 高危")
    p.add_argument("--dock", required=True, help="机场编号")
    p.add_argument("--confirm", action="store_true", help="二次确认（必须添加）")

    args = parser.parse_args()
    token = load_token()

    dispatch = {
        "takeoff": cmd_takeoff,
        "flyto":   cmd_flyto,
        "update":  cmd_update,
        "stop":    cmd_stop,
        "home":    cmd_home,
        "estop":   cmd_estop,
        "grab":    cmd_grab,
        "drc":     cmd_drc,
    }
    dispatch[args.cmd](args, token)


if __name__ == "__main__":
    main()
