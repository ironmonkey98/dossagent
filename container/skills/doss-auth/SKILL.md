---
name: doss-auth
description: |
  登录 DOSS 无人机平台并缓存认证 Token，供所有 doss-* Skill 使用。
  当用户说"登录DOSS"、"连接DOSS"、"doss认证"、"获取doss token"、
  "doss登录"、"初始化doss连接"、"DOSS认证"、"token过期"、"重新登录"、
  "刷新Token"、"检查登录状态"、"DOSS账号"、"认证失败"时触发此 Skill。
  通过 uav-agent 服务管理认证（默认 http://localhost:3000）。
---

# DOSS 认证 Skill

## 概述

通过 uav-agent 服务完成 DOSS 平台登录，Token 由 uav-agent 自动缓存和管理。
所有 doss-* Skill 的 API 调用均通过 uav-agent 代理，Token 自动注入。

## 前置条件

uav-agent 服务运行中：
```bash
curl -s http://localhost:3000/api/health | python3 -m json.tool
```

## 使用流程

### 第一步：检查当前认证状态

```bash
curl -s http://localhost:3000/api/auth/status | python3 -m json.tool
```

返回示例：
```json
{
  "hasCredentials": true,
  "hasToken": true,
  "tokenPreview": "eyJhbGciOiJIUzI1NiJ9..."
}
```

- `hasCredentials: true, hasToken: true` → 已登录，可直接使用
- `hasCredentials: true, hasToken: false` → 凭据已保存但 Token 过期，需重新登录
- `hasCredentials: false` → 需要设置凭据

### 第二步：设置凭据（仅首次或更换账号时）

向用户说明：
> 请提供您的 DOSS 账号信息（密码仅缓存于本地，不会外传）：
> - DOSS 用户名：
> - DOSS 密码：

获取后执行：
```bash
curl -s -X POST http://localhost:3000/api/auth/credentials \
  -H "Content-Type: application/json" \
  -d '{"username": "<用户名>", "password": "<密码>"}'
```

成功返回：`{"success": true, "message": "凭据已保存"}`

### 第三步：触发登录

```bash
curl -s -X POST http://localhost:3000/api/auth/login | python3 -m json.tool
```

成功返回：`{"token": "eyJhbGciOiJIUzI1NiJ9...", "source": "login"}`

### 第四步：展示结果

- **成功**：告知用户 Token 已缓存，可使用所有 doss-* Skill
- **失败**：根据错误信息指导排查（见常见错误）

## 带验证码登录

如果普通登录返回验证码要求，需要通过浏览器辅助：

```bash
# 1. 获取验证码图片和 Session Cookie
curl -s http://localhost:3000/api/auth/captcha | python3 -m json.tool
# 返回 imageBase64（data:image/jpeg;base64,...）和 sessionCookie

# 2. 将验证码图片展示给用户识别

# 3. 带验证码登录
curl -s -X POST http://localhost:3000/api/auth/login-with-captcha \
  -H "Content-Type: application/json" \
  -d '{
    "username": "<用户名>",
    "password": "<密码>",
    "captcha": "<用户输入的验证码>",
    "sessionCookie": "<第一步返回的 sessionCookie>"
  }'
```

## Token 传递方式

所有 uav-agent API 支持 4 种 Token 传递方式（按优先级）：

1. `Authorization: Bearer <token>` 请求头
2. `X-Token: <token>` 请求头
3. `body.token` 请求体字段
4. `query.token` URL 参数

uav-agent 内部会自动缓存 Token，大多数情况下无需手动传递。

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `需要先配置凭据` | 未设置用户名密码 | 执行第二步设置凭据 |
| `用户名或者密码错误` | 账号密码不匹配 | 确认后重新设置凭据 |
| `获取公钥失败` | 网络不通或 DOSS 平台异常 | 检查网络和 VPN |
| `Token已失效` | Token 过期 | 重新执行第三步登录 |
| `uav-agent 连接失败` | 服务未启动 | 先启动 uav-agent |

## 安全说明

- 密码通过 SM2 国密加密后传输，不以明文发送
- Token 缓存于 uav-agent 本地（`data/token-cache.json`）
- 凭据缓存于 uav-agent 本地（`data/credentials-cache.json`）
- 建议定期更换 DOSS 账号密码
