# 🚀 AGY WhatsApp Gateway

An always-online, 24/7 WhatsApp Gateway daemon for **Antigravity (AGY) Agent** inspired by the Nous Research Hermes Agent WhatsApp integration architecture.

Built on top of **[@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)** for lightweight, headless Multi-Device WhatsApp authentication without requiring heavy browser binaries (perfect for **Raspberry Pi** and low-resource home servers).

---

## 🌟 Key Features

1. **📱 Self-Chat & QR Code Authentication**:
   - Renders QR code directly in the terminal CLI for instant scanning via WhatsApp *Linked Devices*.
   - Renders a real-time web dashboard at `http://<ip>:3000` with high-res QR code image for remote setup on headless Raspberry Pi.
   - Native **Self-Chat** support: Message yourself in WhatsApp ("Message Yourself" / own number) to interact with AGY directly!
2. **🟢 24/7 Always Online Daemon**:
   - Auto-reconnect with exponential backoff on network disconnections or session refreshes.
   - Guarded against uncaught exceptions and unhandled promises.
   - Systemd unit generator (`agy-gateway.service`) for running as a persistent 24/7 Linux system daemon.
3. **💬 Interactive Progress & Status Messages**:
   - Sends real-time typing indicators (`composing`).
   - Sends interactive progress updates when AGY executes tools (e.g. `🛠️ Tool: run_command: git status`).
   - Formats Markdown responses into native WhatsApp markup (`*bold*`, `_italic_`, ` ```code``` `).
   - Automatically chunks long responses (>4000 chars) into clean sequential messages.
4. **🎯 Built-in Commands & Slash Features**:
   - `/goal <prompt>` — Spawns long-running goal tasks with high-reasoning effort and step-by-step interactive reporting.
   - `/models` — Lists available LLM models from AGY (`agy models`).
   - `/status` — Displays gateway uptime, connection state, memory usage, and active tasks.
   - `/cancel` — Instantly cancels any ongoing task in the chat.
   - `/btw <note>` — Injects an in-between note or update into an active task without cancelling it.
5. **🔄 Mid-Task Interactivity**:
   - If AGY is currently executing a task and you send a message, it is automatically treated as a `/btw` note and passed to the active process context!

---

## 🛠️ Raspberry Pi & Linux Installation

### 1. Prerequisites
- Raspberry Pi (3B+, 4, 5, or Zero 2 W) running Raspberry Pi OS (64-bit recommended) or Linux.
- Node.js 18+ (`node -v`).
- Antigravity AGY CLI installed (`agy`).

### 2. Quick Setup
Clone or copy this repository to your Raspberry Pi:

```bash
cd ~/
git clone https://github.com/schris88/agy-gateway.git
cd agy-gateway
npm install
```

### 3. Run One-Touch Installer
Run the installer script to link the CLI and install the 24/7 systemd service:

```bash
chmod +x install-service.sh
./install-service.sh
```

### 4. Authenticate WhatsApp QR Code
Start the service in terminal to scan the QR code:

```bash
npm start
```

1. Open **WhatsApp** on your smartphone.
2. Tap **Settings / Menu** &rarr; **Linked Devices** &rarr; **Link a Device**.
3. Point your phone camera at the QR code displayed in your terminal OR navigate to `http://<raspberry-pi-ip>:3000` in your web browser.
4. Once linked, the session credentials will be saved locally to `./auth_info_baileys`.

### 5. Enable 24/7 Background Daemon
Start the systemd daemon so AGY stays online 24/7 across reboots:

```bash
sudo systemctl start agy-gateway
sudo systemctl status agy-gateway
```

View live daemon logs anytime:
```bash
sudo journalctl -u agy-gateway -f
```

---

## ⚙️ Configuration (`.env`)

Create or edit `.env` in the project root:

```env
# Path to AGY CLI binary
AGY_BIN_PATH=/Users/christianstengel/.local/bin/agy

# Enable Self-Chat (messaging yourself in WhatsApp)
WHATSAPP_ALLOW_SELF=true

# Phone number whitelist (comma separated, or * for all)
WHATSAPP_ALLOWED_NUMBERS=*

# Web dashboard & QR viewer port
PORT=3000

# Auth credentials directory
AUTH_DIR=./auth_info_baileys

# Task progress update throttle (ms)
PROGRESS_INTERVAL_MS=4000
```

---

## 📖 Command Reference

| Command | Description | Example |
| :--- | :--- | :--- |
| `/goal <prompt>` | Run a long-running goal task with high reasoning effort | `/goal Refactor stock-analyser component structure` |
| `/models` | List all available AI models | `/models` |
| `/status` | View gateway uptime and running tasks | `/status` |
| `/cancel` | Cancel the active task in current chat | `/cancel` |
| `/btw <note>` | Inject a note into a running task | `/btw Make sure to include unit tests` |
| `<any text>` | Send regular prompt to AGY | `Explain the latest commit in stock-analyser` |

---

## 🏗️ Architecture Overview

```
                          ┌─────────────────────────────┐
                          │   WhatsApp Smartphone App   │
                          └──────────────┬──────────────┘
                                         │ Multi-Device WebSocket
                                         ▼
                          ┌─────────────────────────────┐
                          │    @whiskeysockets/baileys  │ (gateway.js)
                          └──────────────┬──────────────┘
                                         │ Incoming Message / Self Chat
                                         ▼
                          ┌─────────────────────────────┐
                          │     Command Router          │ (commandHandler.js)
                          └──────────────┬──────────────┘
                                         │ /goal, /models, /btw, /cancel, text
                                         ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│ Web Dashboard & QR      │ ◄─┤  AGY Execution Manager  │ (agyRunner.js)
│ http://localhost:3000   │   └──────────┬──────────────┘
└─────────────────────────┘              │ spawn stream-json
                                         ▼
                              ┌────────────────────┐
                              │  agy CLI Process   │
                              └────────────────────┘
```

---

## 📄 License
MIT License
