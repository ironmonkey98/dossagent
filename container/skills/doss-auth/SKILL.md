---
name: doss-auth
description: |
  登录 DOSS 无人机开放共享平台并缓存认证 Token。
  当用户说"登录DOSS"、"连接DOSS"、"doss认证"、"获取doss token"、
  "doss登录"、"初始化doss连接"时触发此 Skill。
  所有 doss-* Skill 都依赖此 Skill 提供的 token。
---

# DOSS 认证 Skill

## 概述

通过 SM2 国密算法安全加密密码，登录 DOSS 平台并将 Token 缓存到本地，
供其他 doss-* Skill 使用。Token 文件路径：`~/.claude/doss_session.json`

## 使用流程

### 第一步：提示用户输入凭证

向用户说明：
> 请提供您的 DOSS 账号信息（不会持久化存储密码）：
> - DOSS 用户名：
> - DOSS 密码：

### 第二步：执行认证脚本

获取用户名和密码后，运行以下命令：

```bash
python3 ~/.claude/skills/doss-auth/scripts/doss_auth.py "<用户名>" "<密码>"
```

### 第三步：展示结果

- **成功**：告知用户 Token 已写入，有效期 24 小时
- **失败**：根据错误信息指导用户排查（见常见错误）

## Token 读取方式（供其他 Skill 使用）

其他 doss-* Skill 需要 Token 时，读取方式：

```python
import json
from pathlib import Path

session_file = Path.home() / ".claude" / "doss_session.json"
session = json.loads(session_file.read_text())
token = session["token"]
# 请求头：{"Authorization": token}
```

或用 Bash：
```bash
TOKEN=$(python3 -c "import json,pathlib; print(json.loads(pathlib.Path.home().joinpath('.claude','doss_session.json').read_text())['token'])")
```

## 环境依赖

安装依赖（首次使用前运行一次）：

```bash
pip install requests gmssl
```

## 常见错误处理

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `缺少 gmssl 库` | SM2 加密库未安装 | `pip install gmssl` |
| `缺少 requests 库` | HTTP 库未安装 | `pip install requests` |
| `获取公钥失败（网络问题）` | 网络不通或 VPN | 检查网络连接或 VPN 状态 |
| `响应中未找到有效 token` | 账号密码错误 | 确认用户名/密码是否正确 |
| `登录请求失败` | 服务器异常 | 稍后重试或联系管理员 |

## Token 有效期说明

- 默认有效期：**24 小时（86400 秒）**
- Token 过期后需重新运行此 Skill 刷新
- 可通过 `saved_at` 字段判断 Token 是否仍有效：

```bash
cat ~/.claude/doss_session.json
```
