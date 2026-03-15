#!/bin/bash
# 用调试端口启动 Chrome，供 pokernow-gpt 辅助模式连接。
# 使用方法：在终端运行  ./start-chrome.sh
# 然后在打开的 Chrome 里进入 PokerNow 游戏并手动坐下，
# 再运行 npx tsx app/index.ts 即可。

PORT=9222
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_DIR="/tmp/pokernow-chrome-profile"

# If the port is already in use, kill the old process and restart Chrome
# so the user always gets a visible window.
if lsof -ti tcp:$PORT > /dev/null 2>&1; then
    echo "⚠️  Port $PORT is already in use. Killing old process and restarting Chrome..."
    lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null
    sleep 1
fi

echo "🚀 正在启动专用调试 Chrome（端口 $PORT）..."
echo "   （这是独立于你日常 Chrome 的窗口，不会互相干扰）"
echo ""

# 用独立 profile 目录强制启动新实例，避免被合并进已有 Chrome
"$CHROME" \
    --remote-debugging-port=$PORT \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    "https://www.pokernow.club" &

# 等待 Chrome 启动并监听端口
for i in $(seq 1 10); do
    sleep 1
    if lsof -ti tcp:$PORT > /dev/null 2>&1; then
        echo "✅ Chrome 已就绪！请在浏览器里："
        echo "   1. 进入你的 PokerNow 游戏"
        echo "   2. 手动坐下（点 SIT，填名字和筹码）"
        echo "   3. 等主持人批准"
        echo ""
        echo "   然后运行：npx tsx app/index.ts"
        exit 0
    fi
done

echo "⚠️  Chrome 启动超时，请手动检查是否打开。"
