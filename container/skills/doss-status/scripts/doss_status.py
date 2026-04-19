#!/usr/bin/env python3
"""
DOSS 状态查询脚本 - 查询机场和无人机实时状态

功能：
  1. 读取缓存 Token（~/.claude/doss_session.json）
  2. 查询机场设备列表（含实时状态）
  3. 查询无人机设备列表（含实时状态）
  4. 格式化输出状态表格

用法：
  python3 doss_status.py [--type dock|drone|all] [--name <设备名称关键词>]
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

# 状态码映射
DOCK_MODE_MAP = {
    "0": "空闲中", "1": "现场调试", "2": "远程调试",
    "3": "固件升级中", "4": "作业中"
}
TASK_STEP_MAP = {
    "0": "作业准备中", "1": "飞行作业中", "2": "作业后恢复",
    "3": "飞行区更新", "4": "地形更新", "5": "任务空闲",
    "255": "飞行器异常", "256": "未知状态"
}
DRONE_MODE_MAP = {
    "0": "待机", "1": "起飞准备", "2": "起飞准备完毕", "3": "手动飞行",
    "4": "自动起飞", "5": "航线飞行", "6": "全景拍照", "7": "智能跟随",
    "8": "ADS-B躲避", "9": "自动返航", "10": "自动降落",
    "11": "强制降落", "12": "三桨叶降落", "13": "升级中",
    "14": "未连接", "15": "APAS", "16": "虚拟摇杆", "17": "指令飞行",
    "18": "空中RTK收敛", "19": "机场选址中"
}
RAINFALL_MAP = {"0": "无雨", "1": "小雨", "2": "中雨", "3": "大雨"}
WIND_DIR_MAP = {
    "1": "正北", "2": "东北", "3": "东", "4": "东南",
    "5": "南", "6": "西南", "7": "西", "8": "西北"
}


def load_token() -> str:
    """读取缓存的 Token，自动检查是否过期"""
    if not SESSION_FILE.exists():
        print("[错误] 未找到 Token 缓存，请先运行 doss-auth 登录")
        sys.exit(1)

    session = json.loads(SESSION_FILE.read_text())
    token = session.get("token", "")
    if not token:
        print("[错误] Token 为空，请重新登录（doss-auth）")
        sys.exit(1)

    # 检查过期
    saved_at = datetime.datetime.fromisoformat(session.get("saved_at", "2000-01-01"))
    expires_in = session.get("expires_in", 86400)
    elapsed = (datetime.datetime.now() - saved_at).total_seconds()
    if elapsed > expires_in:
        print(f"[警告] Token 已过期（{int(elapsed/3600):.0f} 小时前获取），建议重新登录")

    return token


def query_devices(token: str, device_type: str = None) -> list:
    """查询设备列表（机场或无人机）

    device_type: 'unaDock'=机场, 'una'=无人机, None=全部
    """
    url = f"{BASE_URL}/mcdevice/mcDevice/findPageByFieldValuesAuthorized"
    headers = {"Authorization": token}
    params = {
        "pageSize": 100,
        "pageNum": 1,
    }
    if device_type:
        params["deviceTypeCodes"] = device_type

    try:
        # 接口为 POST，参数通过 params 传递，body 为空 JSON
        resp = requests.post(url, headers=headers, params=params, json={}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        # 兼容多种响应结构
        records = (
            data.get("data", {}).get("records")
            or data.get("data", {}).get("list")
            or data.get("data", [])
            or []
        )
        if isinstance(records, dict):
            records = records.get("records") or []
        return records
    except requests.RequestException as e:
        print(f"[错误] 查询设备失败：{e}")
        return []


def query_all_devices(token: str) -> list:
    """使用 findByFieldValuesAuthorized 查询全部设备（含实时状态）"""
    url = f"{BASE_URL}/mcdevice/mcDevice/findByFieldValuesAuthorized"
    headers = {"Authorization": token}
    try:
        # 接口为 POST，不传 realtimeValues（服务端不支持）
        resp = requests.post(url, headers=headers, json={}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        records = data.get("data") or []
        if isinstance(records, dict):
            records = records.get("records") or records.get("list") or []
        return records if isinstance(records, list) else []
    except requests.RequestException as e:
        print(f"[错误] 查询全部设备失败：{e}")
        return []


def get_val(d: dict, key: str, default: str = "—") -> str:
    """安全取值，None 返回默认值"""
    v = d.get(key)
    return str(v) if v is not None else default


def format_dock(device: dict) -> str:
    """格式化机场状态输出（适配真实API字段：deviceName/deviceCode/online/lat/lng）"""
    name = get_val(device, "deviceName", "未命名机场")
    code = get_val(device, "deviceCode", "")
    online = "在线" if get_val(device, "online") == "1" else "离线"
    controllable = "可控" if get_val(device, "controllable") == "1" else "不可控"
    enabled = "已启用" if get_val(device, "enabled") == "1" else "已禁用"
    lat = get_val(device, "lat")
    lng = get_val(device, "lng")
    location = f"{lat}, {lng}" if lat != "—" and lng != "—" else "—"
    place = get_val(device, "place", "")

    lines = [
        f"  机场: {name}  [{code}]",
        f"  状态: {online}  {controllable}  {enabled}",
        f"  位置: {location}",
    ]
    if place and place != "—":
        lines.append(f"  地址: {place}")
    return "\n".join(lines)


def format_drone(device: dict) -> str:
    """格式化无人机状态输出（适配真实API字段：deviceName/deviceCode/online/lat/lng）"""
    name = get_val(device, "deviceName", "未命名无人机")
    code = get_val(device, "deviceCode", "")
    online = "在线" if get_val(device, "online") == "1" else "离线"
    controllable = "可控" if get_val(device, "controllable") == "1" else "不可控"
    enabled = "已启用" if get_val(device, "enabled") == "1" else "已禁用"
    lat = get_val(device, "lat")
    lng = get_val(device, "lng")
    location = f"{lat}, {lng}" if lat != "—" and lng != "—" else "—"
    place = get_val(device, "place", "")

    lines = [
        f"  无人机: {name}  [{code}]",
        f"  状态: {online}  {controllable}  {enabled}",
        f"  位置: {location}",
    ]
    if place and place != "—":
        lines.append(f"  地址: {place}")
    return "\n".join(lines)


def classify_devices(devices: list) -> tuple:
    """将设备列表按类型分类为机场和无人机（根据 deviceType.code 判断）"""
    docks = []
    drones = []
    others = []
    for d in devices:
        dtype_code = (d.get("deviceType") or {}).get("code", "").lower()
        if "dock" in dtype_code:
            docks.append(d)
        elif dtype_code == "una":
            drones.append(d)
        else:
            others.append(d)
    return docks, drones


def main():
    parser = argparse.ArgumentParser(description="DOSS 状态查询")
    parser.add_argument("--type", choices=["dock", "drone", "all"], default="all",
                        help="查询类型：dock=机场, drone=无人机, all=全部（默认）")
    parser.add_argument("--name", default="",
                        help="按设备名称关键词过滤（模糊匹配）")
    args = parser.parse_args()

    token = load_token()

    print(f"\n正在查询 DOSS 设备状态（{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}）...\n")

    # 优先用全量接口，失败再用分页接口
    all_devices = query_all_devices(token)
    if not all_devices:
        # fallback：分页接口
        docks = query_devices(token, "unaDock") if args.type in ("dock", "all") else []
        drones = query_devices(token, "una") if args.type in ("drone", "all") else []
        all_devices = docks + drones

    docks, drones = classify_devices(all_devices)

    # 名称过滤
    if args.name:
        keyword = args.name.lower()
        docks = [d for d in docks if keyword in (d.get("name") or "").lower()]
        drones = [d for d in drones if keyword in (d.get("name") or "").lower()]

    # 按类型输出
    show_dock = args.type in ("dock", "all")
    show_drone = args.type in ("drone", "all")

    if show_dock:
        print(f"═══ 机场状态 ({len(docks)} 台) ═══")
        if docks:
            for d in docks:
                print(format_dock(d))
                print()
        else:
            print("  （无数据）\n")

    if show_drone:
        print(f"═══ 无人机状态 ({len(drones)} 台) ═══")
        if drones:
            for d in drones:
                print(format_drone(d))
                print()
        else:
            print("  （无数据）\n")

    total = (len(docks) if show_dock else 0) + (len(drones) if show_drone else 0)
    print(f"─── 共 {total} 台设备 ───")


if __name__ == "__main__":
    main()
