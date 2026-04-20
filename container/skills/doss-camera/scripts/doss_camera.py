#!/usr/bin/env python3
"""
DOSS 摄像头与负载控制脚本

子命令：
  photo       - 拍照
  record      - 开始/停止录像
  zoom        - 变焦设置
  mode        - 切换相机模式
  lookat      - 看向目标点（经纬高）
  light       - 探照灯控制（模式/亮度）
  speaker     - 喊话器控制（TTS/停止/音量）
  payload     - 抢夺负载控制权

用法示例：
  python3 doss_camera.py photo   --dock DOCK001 --payload 0
  python3 doss_camera.py record  --dock DOCK001 --payload 0 --action start
  python3 doss_camera.py zoom    --dock DOCK001 --payload 0 --factor 10
  python3 doss_camera.py mode    --dock DOCK001 --payload 0 --mode 0
  python3 doss_camera.py lookat  --dock DOCK001 --payload 0 --lon 117.94 --lat 24.55 --height 0
  python3 doss_camera.py light   --dock DOCK001 --payload 2 --mode 1 --brightness 80
  python3 doss_camera.py speaker --dock DOCK001 --payload 3 --text "请注意安全"
  python3 doss_camera.py payload --dock DOCK001 --confirm
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

BASE_URL = "https://doss.xmrbi.com/xmrbi-onecas/uav/cockpit"
STREAM_URL = "https://doss.xmrbi.com/xmrbi-onecas/video/stream/v2/liveStream"
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
    if (datetime.datetime.now() - saved_at).total_seconds() > session.get("expires_in", 86400):
        print("[警告] Token 已过期，建议重新登录（doss-auth）")
    return token


def get_headers(token: str) -> dict:
    return {"Authorization": token, "Content-Type": "application/json"}


def cockpit_post(token: str, dock: str, endpoint: str, payload: dict = None) -> dict:
    url = f"{BASE_URL}/{dock}/{endpoint}"
    try:
        resp = requests.post(url, headers=get_headers(token), json=payload or {}, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print(f"[错误] 请求失败 [{endpoint}]：{e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"  响应：{e.response.text[:300]}")
        sys.exit(1)


def print_result(data: dict, action: str):
    code = str(data.get("code") or data.get("status") or "")
    if code in ("200", "0", "success", "true"):
        print(f"✅ {action} 指令下发成功")
    else:
        msg = data.get("msg") or data.get("message") or str(data.get("data", ""))
        print(f"⚠️  {action} 响应码: {code}，信息: {msg}")


# ─── 子命令 ───────────────────────────────────────────────────────────────────

def cmd_photo(args, token):
    """拍照"""
    print(f"\n拍照指令  机场:{args.dock}  负载:{args.payload}\n")
    data = cockpit_post(token, args.dock, f"cameraPhotoTake/{args.payload}")
    print_result(data, "拍照")


def cmd_record(args, token):
    """开始/停止录像"""
    action_map = {"start": "cameraRecordingStart", "stop": "cameraRecordingStop"}
    endpoint = f"{action_map[args.action]}/{args.payload}"
    label = "开始录像" if args.action == "start" else "停止录像"
    print(f"\n{label}指令  机场:{args.dock}  负载:{args.payload}\n")
    data = cockpit_post(token, args.dock, endpoint)
    print_result(data, label)


def cmd_zoom(args, token):
    """变焦设置（2-200倍）"""
    if not (2 <= args.factor <= 200):
        print("[错误] 变焦倍数范围 2-200")
        sys.exit(1)
    payload = {"zoomFactor": args.factor, "cameraType": args.camera_type}
    print(f"\n变焦指令  机场:{args.dock}  负载:{args.payload}  倍数:{args.factor}x  镜头:{args.camera_type}\n")
    data = cockpit_post(token, args.dock, f"cameraFocalLengthSet/{args.payload}", payload)
    print_result(data, f"变焦{args.factor}x")


def cmd_mode(args, token):
    """切换相机模式"""
    mode_map = {"0": "拍照", "1": "录像", "2": "智能低光", "3": "全景拍照"}
    label = mode_map.get(str(args.mode), f"模式{args.mode}")
    payload = {"cameraMode": str(args.mode)}
    print(f"\n切换相机模式  机场:{args.dock}  负载:{args.payload}  模式:{label}\n")
    data = cockpit_post(token, args.dock, f"cameraModeSwitch/{args.payload}", payload)
    print_result(data, f"切换到{label}模式")


def cmd_lookat(args, token):
    """看向目标点"""
    payload = {"longitude": args.lon, "latitude": args.lat, "height": args.height}
    print(f"\n看向目标点  机场:{args.dock}  负载:{args.payload}")
    print(f"  目标: 经度={args.lon}  纬度={args.lat}  高度={args.height}m\n")
    data = cockpit_post(token, args.dock, f"cameraLookAt/{args.payload}", payload)
    print_result(data, "看向目标点")


def cmd_light(args, token):
    """探照灯控制"""
    mode_map = {"0": "关闭", "1": "常亮", "2": "爆闪"}
    # 设置模式
    if args.mode is not None:
        mode_label = mode_map.get(str(args.mode), str(args.mode))
        payload = {"workMode": str(args.mode)}
        print(f"\n探照灯模式  机场:{args.dock}  负载:{args.payload}  模式:{mode_label}\n")
        data = cockpit_post(token, args.dock, f"lightModeSet/{args.payload}", payload)
        print_result(data, f"探照灯{mode_label}")
    # 设置亮度
    if args.brightness is not None:
        if not (1 <= args.brightness <= 100):
            print("[错误] 亮度范围 1-100")
            sys.exit(1)
        payload = {"brightness": str(args.brightness)}
        print(f"\n探照灯亮度  机场:{args.dock}  负载:{args.payload}  亮度:{args.brightness}%\n")
        data = cockpit_post(token, args.dock, f"lightBrightnessSet/{args.payload}", payload)
        print_result(data, f"探照灯亮度{args.brightness}%")


def cmd_speaker(args, token):
    """喊话器控制"""
    if args.text:
        # TTS 播放
        payload = {"ttsText": args.text}
        if args.volume:
            # 先设置音量
            vol_payload = {"volume": str(args.volume)}
            cockpit_post(token, args.dock, f"speakerPlayVolumeSet/{args.payload}", vol_payload)
        print(f"\n喊话器 TTS  机场:{args.dock}  负载:{args.payload}")
        print(f"  文本: 「{args.text}」  音量: {args.volume or '默认'}\n")
        data = cockpit_post(token, args.dock, f"speakerTtsPlayStart/{args.payload}", payload)
        print_result(data, "喊话器播放")
    elif args.stop:
        print(f"\n停止喊话器  机场:{args.dock}  负载:{args.payload}\n")
        data = cockpit_post(token, args.dock, f"speakerPlayStop/{args.payload}")
        print_result(data, "停止喊话")
    elif args.volume is not None:
        payload = {"volume": str(args.volume)}
        print(f"\n设置喊话器音量  机场:{args.dock}  负载:{args.payload}  音量:{args.volume}\n")
        data = cockpit_post(token, args.dock, f"speakerPlayVolumeSet/{args.payload}", payload)
        print_result(data, f"音量设为{args.volume}")
    else:
        print("[错误] 请指定 --text、--stop 或 --volume")
        sys.exit(1)


def cmd_payload(args, token):
    """抢夺负载控制权"""
    if not args.confirm:
        print("⚠️  危险操作！抢夺负载控制权会中断其他用户的摄像头操作。")
        print("   请添加 --confirm 参数确认执行。")
        sys.exit(0)
    print(f"\n⚠️  抢夺负载控制权  机场:{args.dock}\n")
    data = cockpit_post(token, args.dock, "payloadAuthorityGrab")
    print_result(data, "抢夺负载控制权")


def cmd_stream(args, token):
    """获取实时视频流地址（6.6接口）"""
    payload = [{"deviceCode": args.device, "protocol": args.protocol, "type": str(args.stream_type)}]
    print(f"\n获取实时视频流  设备:{args.device}  协议:{args.protocol}  码流:{args.stream_type}\n")
    try:
        resp = requests.post(
            STREAM_URL,
            headers={"token": token, "Content-Type": "application/json"},
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        print(f"[错误] 视频流请求失败：{e}")
        sys.exit(1)

    if not data.get("success"):
        print(f"⚠️  获取失败：{data.get('msg', '未知错误')}")
        sys.exit(1)

    streams = data.get("list", [])
    if not streams:
        print("⚠️  未返回任何视频流，设备可能不在线或无推流")
        sys.exit(1)

    for s in streams:
        url = s.get("streamUrl", "")
        print(f"✅ 视频流获取成功")
        print(f"   协议：{args.protocol}")
        print(f"   地址：{url}")
        print(f"   平台：{s.get('configName', '-')}  厂商：{s.get('manufacturer', '-')}")
        if args.protocol in ("HLS", "FLV", "WS"):
            print(f"\n   💡 可在浏览器或播放器中打开：{url}")
        elif args.protocol == "RTSP":
            print(f"\n   💡 可用 VLC 打开：vlc \"{url}\"")


# ─── 主入口 ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="DOSS 摄像头与负载控制")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # 公共参数构建器
    def add_dock_payload(p, payload_required=True):
        p.add_argument("--dock", required=True, help="机场编号（dockCode）")
        if payload_required:
            p.add_argument("--payload", type=int, default=0,
                           help="负载索引（默认0=主摄像头；探照灯通常2；喊话器通常3）")

    # photo
    p = sub.add_parser("photo", help="拍照")
    add_dock_payload(p)

    # record
    p = sub.add_parser("record", help="录像控制")
    add_dock_payload(p)
    p.add_argument("--action", choices=["start", "stop"], default="start", help="start/stop")

    # zoom
    p = sub.add_parser("zoom", help="变焦（2-200倍）")
    add_dock_payload(p)
    p.add_argument("--factor", type=float, required=True, help="变焦倍数（2-200）")
    p.add_argument("--camera-type", default="zoom",
                   choices=["zoom", "wide", "ir"], help="镜头类型（默认zoom）")

    # mode
    p = sub.add_parser("mode", help="切换相机模式")
    add_dock_payload(p)
    p.add_argument("--mode", type=int, required=True, choices=[0, 1, 2, 3],
                   help="0=拍照 1=录像 2=智能低光 3=全景拍照")

    # lookat
    p = sub.add_parser("lookat", help="看向目标点")
    add_dock_payload(p)
    p.add_argument("--lon", type=float, required=True, help="目标经度")
    p.add_argument("--lat", type=float, required=True, help="目标纬度")
    p.add_argument("--height", type=float, default=0.0, help="目标高度（m，默认0）")

    # light
    p = sub.add_parser("light", help="探照灯控制")
    add_dock_payload(p)
    p.add_argument("--mode", type=int, choices=[0, 1, 2],
                   help="0=关闭 1=常亮 2=爆闪")
    p.add_argument("--brightness", type=int, help="亮度 1-100")

    # speaker
    p = sub.add_parser("speaker", help="喊话器控制")
    add_dock_payload(p)
    p.add_argument("--text", help="TTS 文本内容")
    p.add_argument("--stop", action="store_true", help="停止播放")
    p.add_argument("--volume", type=int, help="音量 1-100")

    # payload grab
    p = sub.add_parser("payload", help="抢夺负载控制权 ⚠️")
    p.add_argument("--dock", required=True, help="机场编号")
    p.add_argument("--confirm", action="store_true", help="二次确认")

    # stream — 实时视频流
    p = sub.add_parser("stream", help="获取实时视频流地址")
    p.add_argument("--device", required=True, help="无人机 deviceCode（从 doss-status 获取）")
    p.add_argument("--protocol", default="HLS",
                   choices=["RTSP", "RTMP", "HLS", "FLV", "WS"],
                   help="流协议（默认HLS，浏览器兼容性最好）")
    p.add_argument("--stream-type", type=int, default=1, choices=[1, 2],
                   help="码流类型：1=主码流（默认）2=辅码流")

    args = parser.parse_args()
    token = load_token()

    dispatch = {
        "photo":   cmd_photo,
        "record":  cmd_record,
        "zoom":    cmd_zoom,
        "mode":    cmd_mode,
        "lookat":  cmd_lookat,
        "light":   cmd_light,
        "speaker": cmd_speaker,
        "payload": cmd_payload,
        "stream":  cmd_stream,
    }
    dispatch[args.cmd](args, token)


if __name__ == "__main__":
    main()
