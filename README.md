# 🚀 AGY WhatsApp Gateway

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20v6-brightgreen.svg)](https://github.com/WhiskeySockets/Baileys)
[![Antigravity](https://img.shields.io/badge/Agent-Antigravity%20AGY-orange.svg)](https://github.com/nousresearch/hermes-agent)

An always-online, 24/7 WhatsApp Gateway daemon for the **Antigravity (AGY) Agent**, inspired by the Nous Research Hermes Agent architecture.

Built using **[@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)** for lightweight, headless Multi-Device WhatsApp Web protocol execution. It runs seamlessly on low-resource hardware like **Raspberry Pi**, home servers, or cloud VPS instances without requiring heavy Chrome/Puppeteer browser instances.

---

## 💡 Motivation & Background

This project was built to replace my Hermes Agent which wasnt performing well with Deepseek and Qwen Models 

While Hermes Agent provided a solid initial integration, relying on Chinese LLMs (such as DeepSeek or third-party OpenRouter endpoints) frequently resulted in high latency, rate limits, higher API costs, and lower reliability for a real-time 24/7 messaging daemon.

**Antigravity (AGY)** offers a significantly superior foundation:
- **🚀 Faster & Higher Throughput**: Instant response generation using native Google Gemini 3.6 Flash / 3.1 Pro and Claude 3.7 Sonnet backends.
- **💰 Superior Cost Efficiency**: Dramatically lower token cost per interaction with generous subscription capacity.
- **🧠 Better Reasoning & Tool Accuracy**: High precision in multi-step coding, file editing, image generation, and voice note transcription.
- **🔄 Robust Conversation Memory**: Seamless persistent multi-turn history continuity across all WhatsApp messages.

---


## ✨ Features

- **📱 Self-Chat & QR Code Login**:
  - Displays a clean ASCII QR code directly in the terminal CLI upon launch.
  - Hosts a web dashboard at `http://<server-ip>:3000` (or `http://<server-ip>:3000/qr`) to view the QR code in any browser for remote setup on headless servers.
  - Native **Self-Chat** support (`WHATSAPP_ALLOW_SELF=true`): Message yourself in WhatsApp ("Message Yourself" / own contact number) to run commands.
- **🟢 24/7 Always Online Daemon**:
  - Auto-reconnect with exponential backoff on network disconnections.
  - Persistent authentication storage (`auth_info_baileys`).
  - Native systemd service support (`agy-gateway.service`) for Linux/Raspberry Pi.
- **💬 Interactive Progress & Live Updates**:
  - Live typing indicator (`composing`).
  - Intermediate status reporting when AGY executes tools (e.g. `🛠️ Tool: run_command: git status`).
  - Automatic Markdown-to-WhatsApp text formatting (`*bold*`, `_italic_`, ` ```code``` `).
  - Smart message splitting for responses exceeding WhatsApp's character limit (>4000 chars).
- **🎯 Slash Commands (`/goal`, `/models`, `/status`, `/cancel`, `/btw`)**:
  - `/goal <prompt>` — Spawns long-running goal tasks with high reasoning effort and step-by-step reporting.
  - `/models` — Lists available LLMs from AGY (`agy models`).
  - `/status` — Displays gateway uptime, connection state, memory usage, and active tasks.
  - `/cancel` — Instantly terminates the active process for the chat.
  - `/btw <note>` — Appends an in-between note or update to an active task without stopping execution.
- **🔄 Dynamic Mid-Task Interactivity**:
  - Any text message sent while a task is running is automatically captured as a `/btw` note and passed to the active process context.

---

## 🛠️ Architecture

```
                          ┌─────────────────────────────┐
                          │   WhatsApp Smartphone App   │
                          └──────────────┬──────────────┘
                                         │ Multi-Device WebSocket
                                         ▼
                          ┌─────────────────────────────┐
                          │    @whiskeysockets/baileys  │ (src/gateway.js)
                          └──────────────┬──────────────┘
                                         │ Incoming Message / Self Chat
                                         ▼
                          ┌─────────────────────────────┐
                          │     Command Router          │ (src/commandHandler.js)
                          └──────────────┬──────────────┘
                                         │ /goal, /models, /btw, /cancel, text
                                         ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│ Web Dashboard & QR      │ ◄─┤  AGY Execution Manager  │ (src/agyRunner.js)
│ http://localhost:3000   │   └──────────┬──────────────┘
└─────────────────────────┘              │ spawn stream-json
                                         ▼
                              ┌────────────────────┐
                              │  agy CLI Process   │
                              └────────────────────┘
```

---

## 🚀 Quick Start & Installation

### 1. Prerequisites
- **Node.js**: v18 or higher (`node -v`)
- **Antigravity CLI**: Installed at `~/.local/bin/agy` or available on system PATH (`agy --version`)

### 2. Clone & Install
```bash
git clone https://github.com/schris88/agy-gateway.git
cd agy-gateway
npm install
```

### 3. Configuration (`.env`)
Create a `.env` file or modify the defaults:

```env
# Path to AGY CLI binary
AGY_BIN_PATH=/home/sxlib/.local/bin/agy

# Enable Self-Chat (messaging yourself in WhatsApp)
WHATSAPP_ALLOW_SELF=true

# Phone number whitelist (comma separated, or * for all)
WHATSAPP_ALLOWED_NUMBERS=*

# Web server dashboard & QR code port
PORT=3000

# Auth credentials directory
AUTH_DIR=./auth_info_baileys

# Logging level (debug, info, warn, error)
LOG_LEVEL=info
```

### 4. Running locally
```bash
npm start
```
Open **`http://localhost:3000`** in your browser or view the terminal output to scan the QR code using WhatsApp (*Linked Devices*).

---

## 🍓 Raspberry Pi / Linux 24/7 Systemd Deployment

To run the gateway 24/7 as a background service on Raspberry Pi or Linux:

### Option A: User Systemd Service (Recommended)
```bash
mkdir -p ~/.config/systemd/user
cp agy-gateway.service ~/.config/systemd/user/agy-gateway.service

# Reload and start service
systemctl --user daemon-reload
systemctl --user enable agy-gateway.service
systemctl --user start agy-gateway.service
```

### Option B: System Systemd Service
Run the automated installer script:
```bash
chmod +x install-service.sh
./install-service.sh
```

### Managing the Service:
```bash
# Check service status
systemctl --user status agy-gateway.service

# View real-time logs
journalctl --user -u agy-gateway.service -f

# Restart service
systemctl --user restart agy-gateway.service
```

---

## 📖 Command Reference

| Command | Description | Example |
| :--- | :--- | :--- |
| `/goal <prompt>` | Run a long-running goal task with high reasoning effort | `/goal Build a modern REST API in Node.js` |
| `/models` | List all available AI models | `/models` |
| `/status` | View gateway uptime and running tasks | `/status` |
| `/cancel` | Cancel the active task in current chat | `/cancel` |
| `/btw <note>` | Inject a note into a running task | `/btw Ensure error handling is included` |
| `<any text>` | Send regular prompt to AGY | `Explain the project structure` |

---

## 🔧 Troubleshooting

### "Device can't be added" error when scanning QR code
Meta/WhatsApp servers block unauthorized or non-standard browser signatures. `agy-gateway` uses standard browser headers (`Browsers.ubuntu('Chrome')`). If pairing fails:
1. Stop the service: `systemctl --user stop agy-gateway`
2. Clear old session files: `rm -rf auth_info_baileys`
3. Restart the service: `systemctl --user start agy-gateway`
4. Open `http://<server-ip>:3000` and scan the fresh QR code.

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
