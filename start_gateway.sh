#!/usr/bin/env bash

# Navigate to the script's directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "Ensuring single gateway instance by stopping existing services and processes..."

# Stop systemd service (system & user level)
if command -v systemctl &>/dev/null; then
    sudo systemctl stop agy-gateway.service 2>/dev/null || true
    systemctl stop agy-gateway.service 2>/dev/null || true
    systemctl --user stop agy-gateway.service 2>/dev/null || true
fi

# Stop PM2 instance if running
if command -v pm2 &>/dev/null; then
    pm2 stop agy-gateway 2>/dev/null || true
    pm2 delete agy-gateway 2>/dev/null || true
fi

# Kill any existing Node.js gateway processes
PIDS=$(pgrep -f "node.*(index\.js|agy-gateway)" 2>/dev/null || true)
for pid in $PIDS; do
    if [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ]; then
        echo "Killing existing gateway process PID $pid..."
        kill -9 "$pid" 2>/dev/null || true
    fi
done

# Clear any process occupying the gateway port
PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d'=' -f2 | tr -d '\r" ' || true)
PORT=${PORT:-3000}
if command -v lsof &>/dev/null; then
    PORT_PIDS=$(lsof -t -i:"$PORT" 2>/dev/null || true)
    for pid in $PORT_PIDS; do
        if [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ]; then
            echo "Killing process PID $pid on port $PORT..."
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
elif command -v fuser &>/dev/null; then
    fuser -k "${PORT}/tcp" 2>/dev/null || true
fi

sleep 1

# Pull updates and start the gateway
git pull && npm run start

