#!/usr/bin/env python3
"""
DOSS 认证脚本 - 获取并缓存登录 Token

认证流程：
  1. 获取公钥（getConfig 接口）
  2. 明文密码 → Base64 → SM2 加密 → 密文
  3. 提交 form-data 登录（login 接口）
  4. 将 token 写入 ~/.claude/doss_session.json

用法：
  python3 doss_auth.py <username> <password>
"""

import sys
import json
import base64
import argparse
import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("[错误] 缺少 requests 库，请运行: pip install requests")
    sys.exit(1)

try:
    from gmssl import sm2, func
except ImportError:
    print("[错误] 缺少 gmssl 库，请运行: pip install gmssl")
    sys.exit(1)

# ─── 配置常量 ────────────────────────────────────────────────────────────────
BASE_URL = "https://doss.xmrbi.com/xmrbi-onecas"
SESSION_FILE = Path.home() / ".claude" / "doss_session.json"
DEFAULT_EXPTIME = 86400  # 24 小时


def get_public_key() -> str:
    """步骤1：从 DOSS 获取 SM2 公钥"""
    url = f"{BASE_URL}/sys/sysConfig/getConfig"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        # 兼容嵌套结构：data.data.pubKey 或 data.pubKey
        pub_key = (
            data.get("data", {}).get("pubKey")
            or data.get("pubKey")
        )
        if not pub_key:
            raise ValueError(f"响应中未找到 pubKey 字段，完整响应：{data}")
        return pub_key
    except requests.RequestException as e:
        print(f"[错误] 获取公钥失败（网络问题）：{e}")
        sys.exit(1)


def encrypt_password(plain_password: str, pub_key: str) -> str:
    """步骤2：明文密码 → Base64 → SM2 加密

    DOSS 文档规定顺序：先 Base64，再 SM2
    SM2 加密使用未压缩公钥（04 前缀去掉后的 128 位十六进制）
    """
    # Base64 编码
    b64_password = base64.b64encode(plain_password.encode("utf-8")).decode("utf-8")

    # SM2 公钥处理：去掉 "04" 前缀（如有），取前 64 字节为 x，后 64 字节为 y
    hex_pub = pub_key.strip()
    if hex_pub.startswith("04"):
        hex_pub = hex_pub[2:]

    sm2_crypt = sm2.CryptSM2(
        public_key=hex_pub,
        private_key=""  # 加密只需公钥
    )

    # SM2 加密，返回十六进制密文
    encrypted_bytes = sm2_crypt.encrypt(b64_password.encode("utf-8"))
    # gmssl 返回 bytes，转为十六进制字符串
    if isinstance(encrypted_bytes, bytes):
        cipher_text = encrypted_bytes.hex()
    else:
        cipher_text = encrypted_bytes

    return cipher_text


def login(username: str, encrypted_password: str) -> str:
    """步骤3：提交登录，返回 token"""
    url = f"{BASE_URL}/app/sys/login"
    form_data = {
        "userName": username,
        "password": encrypted_password,
        "exptime": str(DEFAULT_EXPTIME),
    }
    try:
        resp = requests.post(url, data=form_data, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        # 兼容多种响应结构
        token = (
            data.get("data", {}).get("token")
            or data.get("token")
            or data.get("data")
        )
        if not token or not isinstance(token, str):
            raise ValueError(f"响应中未找到有效 token，完整响应：{data}")
        return token
    except requests.RequestException as e:
        print(f"[错误] 登录请求失败（网络问题）：{e}")
        sys.exit(1)


def save_session(token: str, username: str) -> None:
    """步骤4：将 token 缓存到 ~/.claude/doss_session.json"""
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    session = {
        "token": token,
        "username": username,
        "saved_at": datetime.datetime.now().isoformat(),
        "expires_in": DEFAULT_EXPTIME,
    }
    SESSION_FILE.write_text(json.dumps(session, ensure_ascii=False, indent=2))
    print(f"[成功] Token 已写入 {SESSION_FILE}")


def main():
    parser = argparse.ArgumentParser(description="DOSS 认证脚本")
    parser.add_argument("username", help="DOSS 用户名")
    parser.add_argument("password", help="DOSS 密码（明文）")
    args = parser.parse_args()

    print(f"[1/4] 获取 SM2 公钥 ...")
    pub_key = get_public_key()
    print(f"[1/4] 公钥获取成功（长度：{len(pub_key)}）")

    print(f"[2/4] 加密密码（Base64 + SM2）...")
    encrypted_pwd = encrypt_password(args.password, pub_key)
    print(f"[2/4] 密码加密完成")

    print(f"[3/4] 登录 DOSS（用户：{args.username}）...")
    token = login(args.username, encrypted_pwd)
    print(f"[3/4] 登录成功")

    print(f"[4/4] 缓存 Token ...")
    save_session(token, args.username)
    print(f"\n✅ 认证完成！Token 有效期 {DEFAULT_EXPTIME // 3600} 小时")
    print(f"   其他 Skill 可从 ~/.claude/doss_session.json 读取 token")


if __name__ == "__main__":
    main()
