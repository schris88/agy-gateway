#!/usr/bin/env bash
set -e

echo "========================================================"
echo " 🍓 AGY WhatsApp Gateway - Raspberry Pi & Linux Installer"
echo "========================================================"

# 1. Check Node.js installation
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed! Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "✅ Node.js version: $(node -v)"
echo "✅ npm version: $(npm -v)"

# 2. Check agy CLI
if ! command -v agy &> /dev/null && [ ! -f "$HOME/.local/bin/agy" ]; then
    echo "⚠️ WARNING: 'agy' binary was not found in PATH or ~/.local/bin/agy."
    echo "   Ensure Antigravity AGY CLI is installed and configured."
fi

# 3. Install NPM dependencies
echo "📦 Installing npm dependencies..."
npm install

# 4. Link CLI binary globally
echo "🔗 Linking agy-gateway CLI command..."
sudo npm link || npm link

# 5. Systemd Service setup (Linux only)
if [ -d "/etc/systemd/system" ]; then
    echo "⚙️ Configuring systemd service for 24/7 background operation..."
    SERVICE_PATH="/etc/systemd/system/agy-gateway.service"
    CURRENT_DIR="$(pwd)"
    CURRENT_USER="$(whoami)"
    NODE_BIN="$(which node)"

    cat <<EOF | sudo tee $SERVICE_PATH > /dev/null
[Unit]
Description=AGY Antigravity WhatsApp Gateway Daemon
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${CURRENT_DIR}
ExecStart=${NODE_BIN} ${CURRENT_DIR}/index.js
Restart=always
RestartSec=10s
Environment=NODE_ENV=production

LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=agy-gateway

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable agy-gateway.service
    echo "✅ Systemd service installed & enabled!"
    echo ""
    echo "Start the 24/7 background service with:"
    echo "  sudo systemctl start agy-gateway"
    echo "Check logs with:"
    echo "  sudo journalctl -u agy-gateway -f"
else
    echo "ℹ️ Non-systemd system detected (macOS / Docker)."
    echo "You can run the gateway using:"
    echo "  npm start"
    echo "Or run via PM2:"
    echo "  npx pm2 start index.js --name agy-gateway"
fi

echo ""
echo "========================================================"
echo "🎉 Installation complete!"
echo "Run 'npm start' or 'sudo systemctl start agy-gateway' to launch."
echo "========================================================"
