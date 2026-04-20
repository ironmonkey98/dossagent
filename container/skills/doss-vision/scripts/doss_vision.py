#!/usr/bin/env python3
"""
doss_vision.py — 调用 Qwen VLM 分析无人机拍摄图片
环境变量：VLM_BASE_URL / VLM_API_KEY / VLM_MODEL（由 container-runner 注入）
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error


SYSTEM_PROMPT = """你是无人机巡检视觉分析专家。分析图片并严格按以下格式输出，不要添加其他内容：

【视觉分析结论】
目标可见性：[清晰 / 模糊 / 不可见]（说明原因）
检测到的异常：
  - [异常描述] 或 无异常
是否满足作业标准：[是 / 否 / 不确定]
建议下一步：[继续下一航点 / 调整变焦 / 抵近拍摄 / 请求人工确认]"""

QUANTITY_EXAMPLES = """量化判断标准：
- 裂缝检测：裂缝占画面 ≥ 60% 视为清晰，否则建议抵近
- 设备检查：目标设备完整出现在画面内，否则调整角度
- 火情识别：任何明火或烟雾立即输出"请求人工确认"
- 正常巡检：无明显异常且画面清晰 → 继续下一航点"""


def call_vlm(image_url: str, task_hint: str) -> str:
    base_url = os.environ.get("VLM_BASE_URL", "").rstrip("/")
    api_key = os.environ.get("VLM_API_KEY", "")
    model = os.environ.get("VLM_MODEL", "qwen3.6-plus")

    if not base_url or not api_key:
        print("[错误] VLM_BASE_URL / VLM_API_KEY 未配置", file=sys.stderr)
        sys.exit(1)

    user_content = [
        {"type": "image_url", "image_url": {"url": image_url}},
        {"type": "text", "text": f"{QUANTITY_EXAMPLES}\n\n任务说明：{task_hint}"},
    ]

    payload = json.dumps({
        "model": model,
        "max_tokens": 512,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_content}],
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{base_url}/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["content"][0]["text"]
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[错误] VLM API 返回 {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[错误] VLM 调用失败: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Qwen VLM 图像分析")
    parser.add_argument("--image-url", required=True, help="无人机拍摄图片 URL")
    parser.add_argument("--task", default="通用巡检，检查目标是否正常", help="任务说明")
    args = parser.parse_args()

    result = call_vlm(args.image_url, args.task)
    print(result)


if __name__ == "__main__":
    main()
