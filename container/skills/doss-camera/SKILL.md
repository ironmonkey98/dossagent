---
name: doss-camera
description: |
  控制 DOSS 无人机摄像头与负载设备，包括拍照、录像、变焦、切换相机模式、
  看向目标点、探照灯控制、喊话器 TTS 播报。
  当用户说"拍照"、"拍张照"、"开始录像"、"停止录像"、"变焦"、"变焦到XX倍"、
  "看向目标"、"开探照灯"、"关探照灯"、"喊话"、"广播"、"TTS播报"、
  "切换红外"、"切换相机模式"、"doss摄像头"、"负载控制"时触发此 Skill。
  依赖 doss-auth 提供的 Token（~/.claude/doss_session.json）。
  需要知道机场编号（dockCode）。
---

# DOSS 摄像头与负载控制 Skill

## 概述

通过命令控制 DOSS 无人机的摄像头（拍照/录像/变焦/模式）、探照灯、喊话器等负载设备。

## 自然语言 → 命令映射

| 用户说 | 执行 |
|--------|------|
| 拍张照片 | `photo --dock <code> --payload 0` |
| 开始/停止录像 | `record --dock <code> --payload 0 --action start/stop` |
| 变焦到20倍 | `zoom --dock <code> --payload 0 --factor 20` |
| 切换到录像/红外模式 | `mode --dock <code> --payload 0 --mode 1/2` |
| 看向经纬度XX,XX | `lookat --dock <code> --payload 0 --lon ... --lat ...` |
| 开探照灯/常亮 | `light --dock <code> --payload 2 --mode 1` |
| 关探照灯 | `light --dock <code> --payload 2 --mode 0` |
| 喊话：请注意安全 | `speaker --dock <code> --payload 3 --text "请注意安全"` |
| 停止喊话 | `speaker --dock <code> --payload 3 --stop` |

> 负载索引：0=主摄像头，1=副摄像头，2=探照灯，3=喊话器（具体以设备为准）

## 命令详解

### 拍照（photo）

```bash
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py photo \
  --dock DOCK001 --payload 0
```

### 录像（record）

```bash
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py record \
  --dock DOCK001 --payload 0 --action start   # 开始
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py record \
  --dock DOCK001 --payload 0 --action stop    # 停止
```

### 变焦（zoom）

变焦范围 2-200 倍，支持 zoom/wide/ir 三种镜头类型。

```bash
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py zoom \
  --dock DOCK001 --payload 0 --factor 20 --camera-type zoom
```

### 切换相机模式（mode）

```bash
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py mode \
  --dock DOCK001 --payload 0 --mode 0  # 0=拍照 1=录像 2=智能低光 3=全景拍照
```

### 看向目标（lookat）

```bash
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py lookat \
  --dock DOCK001 --payload 0 --lon 117.94 --lat 24.55 --height 0
```

### 探照灯（light）

```bash
# 开启常亮，亮度80%
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py light \
  --dock DOCK001 --payload 2 --mode 1 --brightness 80
# 关闭
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py light \
  --dock DOCK001 --payload 2 --mode 0
```

探照灯模式：0=关闭，1=常亮，2=爆闪；亮度范围 1-100。

### 喊话器（speaker）

```bash
# TTS 播报
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py speaker \
  --dock DOCK001 --payload 3 --text "前方施工，请绕行" --volume 80
# 停止播放
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py speaker \
  --dock DOCK001 --payload 3 --stop
```

### 抢夺负载控制权 ⚠️（payload）

> 会中断其他用户的摄像头操作，需 `--confirm` 确认

```bash
python3 ~/.claude/skills/doss-camera/scripts/doss_camera.py payload \
  --dock DOCK001 --confirm
```

## 获取机场编号

若不知道 dockCode，先运行 `doss-status` 查询：
```bash
python3 ~/.claude/skills/doss-status/scripts/doss_status.py --type dock
```
