# 🚀 AGY WhatsApp Gateway

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20v6-brightgreen.svg)](https://github.com/WhiskeySockets/Baileys)
[![Antigravity](https://img.shields.io/badge/Agent-Antigravity%20AGY-orange.svg)](https://github.com/nousresearch/hermes-agent)

An always-online, 24/7 WhatsApp Gateway daemon for the **Antigravity (AGY) Agent**, inspired by the Hermes Agent architecture.

Built using **[@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)** for lightweight, headless Multi-Device WhatsApp Web protocol execution. It runs seamlessly on low-resource hardware like **Raspberry Pi**, home servers, or cloud VPS instances without requiring heavy Chrome/Puppeteer browser instances.

---

## ✨ Features

- **📱 Self-Chat & QR Code Login**:
  - Displays a clean ASCII QR code directly in the terminal CLI upon launch.
  - Web dashboard hosted at `http://<server-ip>:3000` for remote headless setup via QR code, viewing active running tasks, cancelling tasks, and an interactive launch form.
  - Native **Self-Chat** support: Message yourself in WhatsApp ("Message Yourself" / own contact number) to execute commands.
- **🟢 24/7 Always Online Daemon**:
  - Auto-reconnect with exponential backoff on network disconnections.
  - Persistent session authentication storage (`auth_info_baileys`).
  - Native systemd service installer script (`install-service.sh`) for Linux/Raspberry Pi.
- **🎙️ Voice Note Transcription & Media Handling**:
  - Automatic download and fast speech transcription of WhatsApp voice notes with step-by-step progress feedback.
  - Full support for processing images, videos, and document attachments sent in chat.
  - **Auto Media Sending**: Automatically delivers AGY-generated images (PNG, JPG) as WhatsApp Image Cards and generated documents (PDF, CSV, TXT, ZIP) as WhatsApp Document Cards.
- **💬 Interactive Progress & Live Updates**:
  - Live typing indicator (`composing`).
  - Intermediate status reporting when AGY executes tools (e.g. `🛠️ Tool: run_command: git status`).
  - Markdown-to-WhatsApp text formatting (`*bold*`, `_italic_`, ` ```code``` `).
  - Smart message splitting for responses exceeding WhatsApp's character limit (>4000 chars).
  - **Message Queueing**: Send multiple prompts while a task is running, and they will automatically queue up and execute sequentially.
  - **Token Optimization**: Includes a token saving system directive and non-intrusive session turn advisory notice.
- **🎯 Native Gateway Commands**:
  - `/goal <prompt>` — Spawns long-running goal tasks with high reasoning effort and step-by-step updates.
  - `/plan <prompt>` — Executes planning mode before implementation.
  - `/remind <time> <msg>` — Schedules proactive WhatsApp reminders (e.g. `/remind 10m Check server`).
  - `/export <file_path>` — Downloads and sends any server file directly as a WhatsApp Document card.
  - `/reset` / `/clear` — Clears conversation session history and starts a fresh AGY session.
  - `/status` — Displays gateway uptime, active session ID, connection state, and running tasks.
  - `/cancel` — Instantly terminates active task processes for the chat.
  - `/models`, `/skills`, `/agents` — Lists native AGY models, installed skills, and available subagents.
- **👍 Emoji Reaction Feedback**:
  - React to AGY responses with emojis (👍, 👎, ❤️, 🔥, 💡) to record response feedback to local memory. *(Optional: Syncs with Obsidian Vault if AGY memory skill is configured).*
- **🧹 Automatic 7-Day Media Cleanup**:
  - Automatically runs a daily background task to remove temporary WhatsApp voice notes, images, and videos older than 7 days from `/tmp/` (or run manually via `/cleanup`).

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
                                         │ /goal, /plan, /remind, /cancel, text
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

## 🚀 Quick Start & Setup

### 1. Prerequisites
- **Node.js**: v18 or higher (`node -v`)
- **Antigravity CLI**: Installed at `~/.local/bin/agy` or on system PATH (`agy --version`)
- **Audio & Speech Recognition Dependencies** (optional for voice note transcription):
  ```bash
  sudo apt-get update && sudo apt-get install -y ffmpeg flac python3-pip
  python3 -m pip install SpeechRecognition --break-system-packages
  ```

### 2. Clone & Install
```bash
git clone https://github.com/schris88/agy-gateway.git
cd agy-gateway
npm install
```

### 3. Interactive Installation (Recommended)
Run the automated installer script to set up configuration and (optionally) systemd:
```bash
./install-service.sh
```

### 4. Run Locally
```bash
npm start
```
Open **`http://localhost:3000`** in your browser or view terminal output to scan the QR code using WhatsApp (*Linked Devices*).

---

## ⚙️ Configuration (`.env`)

> [!NOTE]
> **All `.env` variables are completely optional!** The gateway works out of the box with intelligent default fallbacks. You only need to create/modify `.env` if you want to override default settings (such as phone number whitelisting). Running `./install-service.sh` configures `.env` interactively.

| Variable | Description | Default / Fallback |
| :--- | :--- | :--- |
| `AGY_BIN_PATH` | Path to `agy` CLI binary | Auto-detected (`~/.local/bin/agy` or `which agy`) |
| `WHATSAPP_ALLOW_SELF` | Enable Self-Chat (messaging yourself) | `true` |
| `WHATSAPP_ALLOWED_NUMBERS` | Allowed phone numbers (comma-separated, e.g. `4917643318140`) | `*` (All allowed) |
| `PORT` | Web dashboard & QR code server port | `3000` |
| `AUTH_DIR` | Session credentials storage directory | `./auth_info_baileys` |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `info` |

---

## 📖 Command Reference

| Command | Description | Example |
| :--- | :--- | :--- |
| `/goal <prompt>` | Run long-running goal task with high reasoning effort | `/goal Build a modern REST API in Node.js` |
| `/plan <prompt>` | Run step-by-step planning task | `/plan Design architecture for app` |
| `/remind <time> <msg>` | Schedule a WhatsApp reminder | `/remind 10m Check server status` |
| `/export <path>` | Send server file as WhatsApp document attachment | `/export README.md` |
| `/reset` or `/clear` | Clear chat history session & start fresh | `/reset` |
| `/status` | View gateway uptime and running tasks | `/status` |
| `/cancel` | Cancel active task running in chat | `/cancel` |
| `/models` | List available native AGY AI models | `/models` |
| `/skills` | List all installed AGY skills & plugins | `/skills` |
| `<any text>` | Send regular prompt to AGY | `Explain the project structure` |

---

## 🍓 24/7 Background Service Deployment

### Option A: Automated Systemd Installer (Recommended for Linux/Raspberry Pi)
```bash
./install-service.sh
sudo systemctl start agy-gateway
```

### Option B: User Systemd Service
```bash
mkdir -p ~/.config/systemd/user
cp agy-gateway.service ~/.config/systemd/user/agy-gateway.service
systemctl --user daemon-reload
systemctl --user enable agy-gateway.service
systemctl --user start agy-gateway.service
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

## 🔧 Troubleshooting

### "Device can't be added" error when scanning QR code
If WhatsApp fails during pairing:
1. Stop the service: `systemctl --user stop agy-gateway`
2. Clear old session files: `rm -rf auth_info_baileys`
3. Restart: `npm start` or `systemctl --user start agy-gateway`
4. Open `http://<server-ip>:3000` and scan the fresh QR code.

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
