#!/usr/bin/env bash
# 一键把当前代码构建并安装到通过 USB 连接的 iPhone 上。
#
# 用法：
#   pnpm --filter @home-inventory/web ios:deploy            # 自动选第一台已连接 iPhone
#   pnpm --filter @home-inventory/web ios:deploy <UDID>     # 指定设备
#   DEVELOPMENT_TEAM=XXXXXXXXXX pnpm ... ios:deploy         # 覆盖 team id
#
# 需要：
#   - 这台 Mac 上 Xcode 已用 Apple ID 登录并生成过 iOS 开发证书
#   - 第一次运行时 iPhone 上要点"信任此电脑"
#   - 安装后首次启动若提示"未受信任的开发者"，去：
#       设置 → 通用 → VPN 与设备管理 → 信任你的 Apple ID

set -euo pipefail

# 解析路径：脚本位于 packages/web/scripts/，cd 到 packages/web
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$WEB_DIR/ios/App"
BUILD_DIR="${IOS_BUILD_DIR:-/tmp/homeinv-build}"
APP_BUNDLE="$BUILD_DIR/Build/Products/Debug-iphoneos/App.app"
BUNDLE_ID="com.zhouyanbo.homeinventory"
DEFAULT_TEAM="9L67H7PVDT"
TEAM_ID="${DEVELOPMENT_TEAM:-$DEFAULT_TEAM}"

# 选择设备
DEVICE_QUERY="${1:-}"
DEVICE_ID="$(DEVICE_QUERY="$DEVICE_QUERY" python3 <<'PY'
import json
import os
import subprocess
import sys

query = os.environ.get("DEVICE_QUERY", "").strip()
try:
    raw = subprocess.check_output(
        ["xcrun", "devicectl", "list", "devices", "--json-output", "-"],
        stderr=subprocess.DEVNULL,
        text=True,
    )
    devices = json.loads(raw).get("result", {}).get("devices", [])
except Exception:
    devices = []

def is_iphone(device):
    hardware = device.get("hardwareProperties", {})
    properties = device.get("deviceProperties", {})
    return (
        hardware.get("deviceType") == "iPhone"
        or hardware.get("productType", "").startswith("iPhone")
        or "iPhone" in properties.get("name", "")
    )

def matches(device, value):
    hardware = device.get("hardwareProperties", {})
    properties = device.get("deviceProperties", {})
    candidates = [
        device.get("identifier", ""),
        hardware.get("udid", ""),
        properties.get("name", ""),
    ]
    return value in candidates

selected = None
if query:
    selected = next((device for device in devices if matches(device, query)), None)
else:
    selected = next((device for device in devices if is_iphone(device)), None)

if selected:
    print(selected.get("identifier", ""))
PY
)"
if [ -z "$DEVICE_ID" ]; then
  echo "❌ 没有发现任何已连接的 iPhone。请用 USB 连上手机并解锁后重试。" >&2
  exit 1
fi
echo "📱 目标设备: $DEVICE_ID"

# 1. 构建 web + cap sync
echo
echo "🛠  Step 1/4  pnpm build && cap sync ios"
cd "$WEB_DIR"
pnpm build
pnpm exec cap sync ios

# 2. xcodebuild 构建 .app
echo
echo "🛠  Step 2/4  xcodebuild (Team: $TEAM_ID)"
cd "$IOS_DIR"
xcodebuild \
  -project App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_DIR" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  build \
  | tail -20

if [ ! -d "$APP_BUNDLE" ]; then
  echo "❌ 构建产物未找到: $APP_BUNDLE" >&2
  exit 1
fi

# 3. 配对（首次运行需要，幂等）
echo
echo "🔗 Step 3/4  确保设备已配对并就绪"
xcrun devicectl manage pair --device "$DEVICE_ID" >/dev/null 2>&1 || true

# 等设备进入 available/connected/paired 状态（最长 30 秒）
wait_device_ready() {
  local i=0
  while [ $i -lt 30 ]; do
    local state
    state="$(xcrun devicectl list devices 2>/dev/null \
      | awk -v id="$DEVICE_ID" '$0 ~ id { for (j=1;j<=NF;j++) if ($j ~ /^(available|connected|paired)/) { print $j; exit } }')"
    if [ -n "$state" ]; then
      echo "   设备状态: $state"
      return 0
    fi
    if [ $i -eq 0 ]; then
      echo "   等设备就绪…（请保持 iPhone 解锁、USB 插着）"
    fi
    sleep 1
    i=$((i+1))
  done
  echo "❌ 等待设备就绪超时（30s），请解锁手机后重试。" >&2
  return 1
}
wait_device_ready

# 4. 安装 + 启动
echo
echo "📦 Step 4/4  安装并启动"
# install 失败时再重试一次（常见原因：刚连上设备还没握手完成）
if ! xcrun devicectl device install app --device "$DEVICE_ID" "$APP_BUNDLE"; then
  echo "   首次安装失败，3 秒后重试一次…"
  sleep 3
  xcrun devicectl device install app --device "$DEVICE_ID" "$APP_BUNDLE"
fi
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"

echo
echo "✅ 已安装并启动 $BUNDLE_ID 到设备 $DEVICE_ID"
