# 视觉导航调试日志 — 2026-04-30

## 测试目标
F06 无人机起飞 → 视觉搜索中庭水池

## 设备信息
- 机场：软三F06机场 (`8UUXN6A00A0ALQ`)
- 无人机：软三F06无人机 (`1581F8HHX253L00A00V0`)，Matrice 4D
- 在线状态：online=1，available=false
- 坐标：null（未缓存）
- uav-agent 端口：8699

## 执行记录

### 1. 起飞（FAILED）
```
POST /api/execute
{
  "dockCode": "1581F8HHX253L00A00V0",
  "actions": [{"cmd": "takeoffToPoint", "height": 50, "takeoffHeight": 30}]
}
→ 返回 success:true, taskId: task_1777517569532
→ 实际：无人机未起飞
```

### 2. 视觉搜索（启动但可能无效，因为未起飞）
```
POST /api/visual-search
{
  "dockCode": "1581F8HHX253L00A00V0",
  "targetLng": 118.083, "targetLat": 24.612,
  "targetHeight": 30,
  "instruction": "中庭水池、喷泉、水景"
}
→ 返回 success:true, taskId: visual_search_1777517664759
```

## 问题分析

### 起飞失败可能原因：
1. **缺少经纬度**：takeoffToPoint 未传 longitude/latitude，API 可能静默失败
2. **available=false**：机场可能正在执行其他任务或无人机状态不允许起飞
3. **dockCode 传错**：传了无人机编号而非机场编号，但 execute 路由会反查
4. **cockpit API 报错但被吞**：execute 是异步的，错误通过 WS 推送但没看到日志
5. **抢控失败**：可能需要先抢夺控制权

### 需要排查：
- [ ] 查看 cockpit API 实际返回（需要 uav-agent 日志）
- [ ] 确认机场是否空闲（doss-status）
- [ ] 尝试带坐标的起飞
- [ ] 检查是否需要手动抢控

## 下一步
1. 给 uav-agent 加 stdout 日志重定向到文件
2. 重新执行起飞，带坐标
3. 监控实际 API 调用结果

### 3. 拍照（成功发送指令）
- cameraPhotoTake 指令已发送，但无法确认是否实际拍照

### 4. 抓帧分析（FAILED）
- `liveStreamSnapshot` API 404，路径不对
- 需要排查正确的图传抓帧 API 路径
- cockpitData 中可能有正确的 payloadIndex 和流地址

## 待解决问题
1. **图传抓帧 API**：liveStreamSnapshot 返回 404，需要查 getCockpitData 获取正确的流地址
2. **起飞坐标**：中庭水池的经纬度未知，需要用户提供
3. **VLM 分析**：图传抓帧解决后，调用 doss_vision.py 或直接调 VLM API

## F06 设备信息（确认）
- 机场编号: `8UUXN6A00A0ALQ`（cockpit API 用这个）
- 无人机编号: `1581F8HHX253L00A00V0`
- cameraIndex: `98-0-0`
- uav-agent 端口: 8699
- 日志: /Users/yehong/dossagent/uav-agent/logs/agent.log
