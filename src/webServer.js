const express = require('express');
const QRCode = require('qrcode');
const logger = require('./logger');
const config = require('./config');
const { getAllActiveTasks } = require('./agyRunner');

let currentQrCode = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED
let meInfo = null;

function setQrCode(qr) {
  currentQrCode = qr;
  if (qr) {
    connectionStatus = 'WAITING_FOR_QR_SCAN';
  }
}

function setConnectionStatus(status, me = null) {
  connectionStatus = status;
  if (status === 'CONNECTED') {
    currentQrCode = null;
    if (me) meInfo = me;
  }
}

function startWebServer() {
  const app = express();

  app.get('/', async (req, res) => {
    let qrHtml = '';
    if (currentQrCode) {
      try {
        const qrDataUrl = await QRCode.toDataURL(currentQrCode, { width: 300, margin: 2 });
        qrHtml = `
          <div class="qr-card">
            <h2>📱 Scan with WhatsApp</h2>
            <p>Open WhatsApp on your phone &rarr; Linked Devices &rarr; Link a Device</p>
            <img src="${qrDataUrl}" alt="WhatsApp QR Code" />
            <p class="refresh-note">QR code updates automatically. Refresh if expired.</p>
          </div>
        `;
      } catch (e) {
        qrHtml = `<p>Error rendering QR code: ${e.message}</p>`;
      }
    } else if (connectionStatus === 'CONNECTED') {
      qrHtml = `
        <div class="status-card success">
          <h2>✅ Connected to WhatsApp</h2>
          <p><strong>Account:</strong> ${meInfo ? meInfo.name || meInfo.id : 'Linked WhatsApp Account'}</p>
          <p><strong>Status:</strong> Gateway active & listening 24/7</p>
        </div>
      `;
    } else {
      qrHtml = `
        <div class="status-card warning">
          <h2>⏳ Gateway ${connectionStatus}</h2>
          <p>Please wait for initial connection or QR code generation...</p>
        </div>
      `;
    }

    const activeTasks = getAllActiveTasks();
    let tasksHtml = '<p>No active background tasks.</p>';
    if (activeTasks.length > 0) {
      tasksHtml = `
        <ul>
          ${activeTasks.map(t => `
            <li>
              <strong>Chat:</strong> ${t.jid} | <strong>Goal:</strong> ${t.isGoal} |
              <strong>Running:</strong> ${Math.round(t.durationMs / 1000)}s |
              <strong>Prompt:</strong> ${t.prompt.slice(0, 80)}...
            </li>
          `).join('')}
        </ul>
      `;
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Antigravity AGY WhatsApp Gateway</title>
        <meta http-equiv="refresh" content="${currentQrCode ? '10' : '30'}">
        <style>
          :root {
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-color: #f8fafc;
            --accent-color: #38bdf8;
            --success-color: #4ade80;
            --warning-color: #fbbf24;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 2rem;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .container {
            max-width: 600px;
            width: 100%;
          }
          header {
            text-align: center;
            margin-bottom: 2rem;
          }
          h1 {
            color: var(--accent-color);
            margin-bottom: 0.5rem;
          }
          .qr-card, .status-card {
            background-color: var(--card-bg);
            border-radius: 16px;
            padding: 2rem;
            text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            margin-bottom: 2rem;
          }
          .qr-card img {
            border-radius: 12px;
            margin: 1rem 0;
          }
          .refresh-note {
            font-size: 0.85rem;
            color: #94a3b8;
          }
          .success h2 { color: var(--success-color); }
          .warning h2 { color: var(--warning-color); }
          .tasks-section {
            background-color: var(--card-bg);
            border-radius: 16px;
            padding: 1.5rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <header>
            <h1>🚀 AGY WhatsApp Gateway</h1>
            <p>Antigravity Agent Daemon & Chat Bridge</p>
          </header>
          <main>
            ${qrHtml}
            <div class="tasks-section">
              <h3>⚡ Active Execution Tasks</h3>
              ${tasksHtml}
            </div>
          </main>
        </div>
      </body>
      </html>
    `);
  });

  app.get('/qr', async (req, res) => {
    if (!currentQrCode) {
      return res.status(404).send('No QR code currently available (already connected or initializing).');
    }
    try {
      const qrImageBuffer = await QRCode.toBuffer(currentQrCode, { width: 400 });
      res.type('png').send(qrImageBuffer);
    } catch (e) {
      res.status(500).send(`QR generation error: ${e.message}`);
    }
  });

  app.get('/status', (req, res) => {
    res.json({
      status: connectionStatus,
      me: meInfo,
      activeTasks: getAllActiveTasks(),
      uptimeSeconds: process.uptime(),
      memoryUsage: process.memoryUsage()
    });
  });

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`🌐 Web Dashboard & QR server running on http://0.0.0.0:${config.port}`);
  });

  return server;
}

module.exports = {
  startWebServer,
  setQrCode,
  setConnectionStatus
};
