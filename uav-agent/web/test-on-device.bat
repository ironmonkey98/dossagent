@echo off
echo ========================================
echo   UAV Agent 语音输入 - 真机测试
echo ========================================
echo.

:: 获取本机 IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "ipv4" ^| findstr /v "127.0.0.1"') do (
    set LOCAL_IP=%%a
    goto :found
)
:found

:: 清理 IP 格式
set LOCAL_IP=%LOCAL_IP: =%

echo 你的本机 IP 地址: %LOCAL_IP%
echo.
echo 请在手机或其他设备上访问以下地址：
echo.
echo   http://%LOCAL_IP%:8081
echo.
echo ========================================
echo   重要提示：
echo ========================================
echo.
echo 1. 确保手机和电脑在同一 WiFi 网络
echo 2. 使用 Chrome 浏览器（推荐）
echo 3. 如果麦克风无法使用，可能需要 HTTPS
echo.
echo 如需 HTTPS 测试，请按 Ctrl+C 停止，然后运行：
echo   npx localtunnel --port 8081
echo.
echo ========================================
echo.

:: 启动开发服务器
cd /d "%~dp0"
npm run serve

pause
