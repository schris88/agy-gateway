const express = require('express');
const qrcode = require('qrcode');
const os = require('os');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const app = express();
let currentQrCode = null;
let connectionStatus = 'DISCONNECTED';
let connectedUser = null;

app.use(express.json());

function setQrCode(qr) {
  currentQrCode = qr;
}

function setConnectionStatus(status, user = null) {
  connectionStatus = status;
  if (user) connectedUser = user;
}

// Serve Web Dashboard
app.get('/', async (req, res) => {
  if (connectionStatus === 'CONNECTED') {
    const uptimeMin = Math.round(process.uptime() / 60);
    const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
    const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
    const usedMem = Math.round((totalMem - freeMem) * 10) / 10;
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Raspberry Pi 5 CPU';
    const cpuCount = cpus.length;

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AGY WhatsApp Gateway Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --accent: #3b82f6;
      --green: #10b981;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    .header {
      width: 100%;
      background: rgba(30, 41, 59, 0.8);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding: 20px 0;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 1.6rem;
      font-weight: 700;
      background: linear-gradient(135deg, #60a5fa, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .container {
      max-width: 900px;
      width: 90%;
      margin: 30px auto;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--card);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
    }
    .card h2 {
      font-size: 1.1rem;
      margin-top: 0;
      margin-bottom: 15px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: var(--green);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--green);
      margin-right: 8px;
      box-shadow: 0 0 8px var(--green);
    }
    .stat-val {
      font-size: 1.8rem;
      font-weight: 700;
      margin: 10px 0 5px 0;
      color: #fff;
    }
    .stat-label {
      font-size: 0.85rem;
      color: var(--muted);
    }
    .list-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 0.9rem;
    }
    .list-item:last-child {
      border-bottom: none;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🍓 AGY WhatsApp Gateway Dashboard</h1>
    <p style="margin: 5px 0 0 0; color: var(--muted); font-size: 0.9rem;">Raspberry Pi 5 Server Daemon</p>
  </div>
  <div class="container">
    <div class="card">
      <h2>Connection Status</h2>
      <div class="status-badge"><div class="status-dot"></div> Connected & Online</div>
      <div style="margin-top: 15px;">
        <div class="list-item"><span>User Name:</span> <strong>${connectedUser?.name || 'WhatsApp User'}</strong></div>
        <div class="list-item"><span>User ID:</span> <strong>${connectedUser?.id ? connectedUser.id.split('@')[0] : 'Paired'}</strong></div>
        <div class="list-item"><span>Gateway Mode:</span> <strong>Self-Chat / Daemon</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>Raspberry Pi 5 System Hardware</h2>
      <div class="stat-val">${usedMem} GB <span style="font-size: 1rem; color: var(--muted);">/ ${totalMem} GB RAM</span></div>
      <div class="stat-label">Memory Usage</div>
      <div style="margin-top: 15px;">
        <div class="list-item"><span>Processor:</span> <strong>${cpuCount} Cores (${cpuModel.slice(0, 20)})</strong></div>
        <div class="list-item"><span>Daemon Uptime:</span> <strong>${uptimeMin} minutes</strong></div>
        <div class="list-item"><span>Platform:</span> <strong>${os.type()} ${os.arch()}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>Native AGY Slash Controls</h2>
      <div style="font-size: 0.9rem; color: var(--muted); line-height: 1.6;">
        Send commands directly in your WhatsApp chat:<br>
        • <code>/goal &lt;prompt&gt;</code> — High reasoning task<br>
        • <code>/plan &lt;prompt&gt;</code> — Step-by-step plan<br>
        • <code>/remind &lt;time&gt; &lt;msg&gt;</code> — Schedule alert<br>
        • <code>/export &lt;path&gt;</code> — Download file card<br>
        • <code>/models</code> — List available AGY LLMs<br>
        • <code>/skills</code> — List installed plugins<br>
        • <code>/status</code> — Live gateway status
      </div>
    </div>
  </div>
</body>
</html>
    `);
    return;
  }

  if (!currentQrCode) {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="3">
  <title>AGY Gateway - Initializing...</title>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .loader { border: 4px solid #1e293b; border-top: 4px solid #3b82f6; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loader"></div>
  <h2>Initializing WhatsApp Gateway...</h2>
  <p style="color: #94a3b8;">Generating QR Code, please wait...</p>
</body>
</html>
    `);
    return;
  }

  try {
    const qrDataUrl = await qrcode.toDataURL(currentQrCode);
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="15">
  <title>AGY Gateway - Scan QR Code</title>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; border-radius: 20px; padding: 30px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 400px; }
    img { border-radius: 12px; margin: 20px 0; background: white; padding: 15px; }
    h2 { margin: 0; color: #60a5fa; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>📱 Link WhatsApp Account</h2>
    <p>Open WhatsApp on your phone &rarr; <b>Linked Devices</b> &rarr; <b>Link a Device</b> and scan this QR code:</p>
    <img src="${qrDataUrl}" alt="WhatsApp QR Code" width="260" height="260" />
    <p style="font-size: 0.8rem; color: #64748b;">Page refreshes automatically every 15s</p>
  </div>
</body>
</html>
    `);
  } catch (err) {
    res.status(500).send('Error rendering QR code');
  }
});

function startWebServer() {
  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`🌐 Web Dashboard & QR server running on http://0.0.0.0:${config.port}`);
  });
}

module.exports = {
  startWebServer,
  setQrCode,
  setConnectionStatus
};
