#!/usr/bin/env python3
"""
DOSS 实时监控脚本

子命令：
  watch     - WebSocket 实时订阅设备遥测数据（持续输出）
  alerts    - 查询最近告警事件（HTTP 轮询）
  stream    - 获取实时视频流地址
  history   - 查询无人机历史轨迹

用法示例：
  python3 doss_monitor.py watch   --device <deviceCode> [--duration 60]
  python3 doss_monitor.py alerts  [--limit 20] [--unprocessed]
  python3 doss_monitor.py stream  --dock DOCK001 [--protocol HLS]
  python3 doss_monitor.py history --device <aircraftCode> --start "2026-03-12 10:00:00" --end "2026-03-12 11:00:00"
"""

import sys
import json
import time
import signal
import argparse
import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("[错误] 缺少 requests 库，请运行: pip install requests")
    sys.exit(1)

BASE_URL = "https://doss.xmrbi.com/xmrbi-onecas"
WS_URL = "wss://doss.xmrbi.com/websocket/"
SESSION_FILE = Path.home() / ".claude" / "doss_session.json"


def load_session() -> dict:
    if not SESSION_FILE.exists():
        print("[错误] 未找到 Token 缓存，请先运行 doss-auth 登录")
        sys.exit(1)
    return json.loads(SESSION_FILE.read_text())


def load_token() -> str:
    session = load_session()
    token = session.get("token", "")
    if not token:
        print("[错误] Token 为空，请重新登录（doss-auth）")
        sys.exit(1)
    saved_at = datetime.datetime.fromisoformat(session.get("saved_at", "2000-01-01"))
    if (datetime.datetime.now() - saved_at).total_seconds() > session.get("expires_in", 86400):
        print("[警告] Token 已过期，建议重新登录（doss-auth）")
    return token


def get_headers(token: str) -> dict:
    return {"Authorization": token}


# 状态码映射（无人机）
DRONE_MODE = {
    "0": "待机", "1": "起飞准备", "4": "自动起飞", "5": "航线飞行",
    "9": "自动返航", "10": "自动降落", "14": "未连接", "17": "指令飞行"
}
DOCK_MODE = {"0": "空闲中", "1": "现场调试", "2": "远程调试", "3": "固件升级", "4": "作业中"}


# ─── 子命令：watch（WebSocket 实时监控）─────────────────────────────────────────

def cmd_watch(args, token: str):
    """WebSocket 实时订阅设备遥测"""
    try:
        import websocket
    except ImportError:
        print("[错误] 缺少 websocket-client 库，请运行: pip install websocket-client")
        sys.exit(1)

    session = load_session()
    username = session.get("username", "user")

    ws_url = (
        f"{WS_URL}?userId=1&useunitId=1"
        f"&loginName={username}&clientType=bs&token={token}"
    )

    # 订阅消息
    subscribe_msg = json.dumps({
        "type": "subscribe",
        "deviceCode": args.device,
    })

    duration = args.duration
    start_time = time.time()
    received = [0]

    def on_message(ws, message):
        received[0] += 1
        try:
            data = json.loads(message)
            ts = datetime.datetime.now().strftime("%H:%M:%S")
            rtv = data.get("realtimeValueMap") or data.get("data") or data

            # 简洁输出关键遥测字段
            capacity = rtv.get("capacityPercent", "—")
            mode_code = str(rtv.get("modeCode", ""))
            mode = DRONE_MODE.get(mode_code) or DOCK_MODE.get(mode_code) or f"未知({mode_code})"
            lat = rtv.get("latitude", "—")
            lng = rtv.get("longitude", "—")
            height = rtv.get("relativeHeight") or rtv.get("height", "—")
            speed = rtv.get("speed", "—")
            wind = rtv.get("windSpeed", "—")

            print(
                f"[{ts}] 状态:{mode}  电量:{capacity}%  "
                f"位置:{lat},{lng}  高度:{height}m  "
                f"速度:{speed}m/s  风速:{wind}m/s"
            )

            # 超时自动退出
            if duration and (time.time() - start_time) >= duration:
                ws.close()
        except Exception:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] 原始数据: {message[:200]}")

    def on_open(ws):
        print(f"✅ WebSocket 已连接，订阅设备: {args.device}")
        print(f"   监控时长: {'持续' if not duration else f'{duration}秒'}  按 Ctrl+C 退出\n")
        ws.send(subscribe_msg)

    def on_error(ws, error):
        print(f"[错误] WebSocket 错误: {error}")

    def on_close(ws, code, msg):
        print(f"\n连接已关闭，共收到 {received[0]} 条遥测数据")

    def signal_handler(sig, frame):
        print("\n用户中断监控")
        ws_app.close()

    signal.signal(signal.SIGINT, signal_handler)

    ws_app = websocket.WebSocketApp(
        ws_url,
        on_message=on_message,
        on_open=on_open,
        on_error=on_error,
        on_close=on_close,
    )
    ws_app.run_forever()


# ─── 子命令：alerts（查询告警）───────────────────────────────────────────────────

def cmd_alerts(args, token: str):
    """查询最近识别告警事件"""
    url = f"{BASE_URL}/uav/alarm/list"
    params = {"pageNum": 1, "pageSize": args.limit}
    if args.unprocessed:
        params["alarmProcessState"] = "0"

    try:
        resp = requests.get(url, headers=get_headers(token), params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        records = data.get("data", {}).get("records") or data.get("data", {}).get("list") or []
        total = data.get("data", {}).get("total", len(records))

        process_map = {"0": "未处理", "1": "已处理", "2": "误报"}
        identify_map = {"1": "边端识别", "2": "云端识别", "3": "对比检测"}

        print(f"\n告警事件（最近 {len(records)} 条 / 共 {total} 条）\n{'─'*60}")
        if not records:
            print("  （无数据）")
            return

        for e in records:
            eid = e.get("id", "—")
            model = e.get("model", "—")
            labels = e.get("labels", "—")
            lnglat = e.get("lnglat", "—")
            event_time = e.get("eventTime", "—")
            proc = process_map.get(str(e.get("alarmProcessState", "")), "—")
            identify = identify_map.get(str(e.get("alarmIdentifyMethod", "")), "—")
            task_id = (e.get("flightTask") or {}).get("id", "—")

            print(f"  [{event_time}] {model} | {labels}")
            print(f"    位置:{lnglat}  识别:{identify}  处理:{proc}  任务:{task_id}")
            print()

    except requests.RequestException as e:
        print(f"[错误] 查询告警失败：{e}")


# ─── 子命令：stream（获取视频流）─────────────────────────────────────────────────

def cmd_stream(args, token: str):
    """获取实时视频流地址"""
    url = f"{BASE_URL}/uav/cockpit/{args.dock}/getLiveStream"

    protocol_map = {"RTMP": 1, "GB28181": 3, "WebRTC": 4, "HLS": 4}
    url_type = protocol_map.get(args.protocol.upper(), 4)

    payload = {"urlType": url_type, "videoQuality": args.quality}

    try:
        resp = requests.post(
            url,
            headers={**get_headers(token), "Content-Type": "application/json"},
            json=payload,
            timeout=15
        )
        resp.raise_for_status()
        data = resp.json()
        stream_data = data.get("data") or {}

        print(f"\n视频流信息  机场:{args.dock}  协议:{args.protocol}\n{'─'*60}")
        if isinstance(stream_data, list):
            for item in stream_data:
                video_id = item.get("videoId", "—")
                stream_url = item.get("streamUrl") or item.get("url", "—")
                print(f"  VideoID: {video_id}")
                print(f"  流地址:  {stream_url}\n")
        elif isinstance(stream_data, dict):
            stream_url = stream_data.get("streamUrl") or stream_data.get("url", str(stream_data))
            print(f"  流地址: {stream_url}")
        else:
            print(f"  响应: {data}")

        print(f"\n提示：HLS/RTMP 流可用 VLC 或 ffplay 播放")
        print(f"  ffplay <stream_url>")

    except requests.RequestException as e:
        print(f"[错误] 获取视频流失败：{e}")


# ─── 子命令：history（历史轨迹）──────────────────────────────────────────────────

def cmd_history(args, token: str):
    """查询无人机历史 GPS 轨迹（时间区间最大1小时）"""
    url = f"{BASE_URL}/gps/gps-record/queryGpsTrack"
    params = {
        "aircraftCode": args.device,
        "beginDate": args.start,
        "endDate": args.end,
        "geodeticSystem": args.coord,
    }

    try:
        resp = requests.get(url, headers=get_headers(token), params=params, timeout=20)
        resp.raise_for_status()
        data = resp.json()
        points = data.get("data") or []

        if not isinstance(points, list):
            points = []

        print(f"\n历史轨迹  设备:{args.device}  {args.start} ~ {args.end}")
        print(f"坐标系:{args.coord}  共 {len(points)} 个轨迹点\n{'─'*60}")

        if not points:
            print("  （无轨迹数据）")
            return

        # 输出前5和后5个点，中间省略
        display = points if len(points) <= 10 else points[:5] + [None] + points[-5:]
        for p in display:
            if p is None:
                print(f"  ... （省略 {len(points)-10} 个中间点） ...")
                continue
            lat = p.get("latitude", "—")
            lng = p.get("longitude", "—")
            alt = p.get("altitude", "—")
            speed = p.get("speed", "—")
            print(f"  {lat}, {lng}  高度:{alt}m  速度:{speed}m/s")

        # 输出 GeoJSON 格式（方便在地图工具中可视化）
        if args.geojson:
            coords = [[p["longitude"], p["latitude"]] for p in points
                      if p.get("longitude") and p.get("latitude")]
            geojson = {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {"device": args.device, "start": args.start, "end": args.end}
            }
            out_file = Path(f"track_{args.device}_{args.start[:10]}.geojson")
            out_file.write_text(json.dumps(geojson, ensure_ascii=False, indent=2))
            print(f"\n✅ GeoJSON 已保存至 {out_file}")

    except requests.RequestException as e:
        print(f"[错误] 查询轨迹失败：{e}")


# ─── 主入口 ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="DOSS 实时监控")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # watch
    p = sub.add_parser("watch", help="WebSocket 实时监控设备遥测")
    p.add_argument("--device", required=True, help="设备编号（aircraftCode 或 dockCode）")
    p.add_argument("--duration", type=int, default=0,
                   help="监控时长（秒，0=持续监控直到 Ctrl+C）")

    # alerts
    p = sub.add_parser("alerts", help="查询最近告警事件")
    p.add_argument("--limit", type=int, default=20, help="返回条数（默认20）")
    p.add_argument("--unprocessed", action="store_true", help="只显示未处理告警")

    # stream
    p = sub.add_parser("stream", help="获取实时视频流地址")
    p.add_argument("--dock", required=True, help="机场编号")
    p.add_argument("--protocol", default="HLS",
                   choices=["HLS", "RTMP", "WebRTC", "GB28181"], help="协议类型（默认HLS）")
    p.add_argument("--quality", type=int, default=0,
                   help="画质 0=自适应 1=流畅 2=标清 3=高清 4=超清（默认0）")

    # history
    p = sub.add_parser("history", help="查询无人机历史轨迹")
    p.add_argument("--device", required=True, help="无人机编号（aircraftCode）")
    p.add_argument("--start", required=True, help="开始时间（2026-03-12 10:00:00）")
    p.add_argument("--end", required=True, help="结束时间（最多1小时区间）")
    p.add_argument("--coord", default="wgs-84",
                   choices=["wgs-84", "bd-09", "gcj-02"],
                   help="坐标系（默认wgs-84原始坐标）")
    p.add_argument("--geojson", action="store_true", help="同时输出 GeoJSON 文件")

    args = parser.parse_args()
    token = load_token()

    dispatch = {
        "watch":   cmd_watch,
        "alerts":  cmd_alerts,
        "stream":  cmd_stream,
        "history": cmd_history,
    }
    dispatch[args.cmd](args, token)


if __name__ == "__main__":
    main()
