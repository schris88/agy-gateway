const express = require('express');
const qrcode = require('qrcode');
const os = require('os');
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

function createDashboardGatewayRef() {
  // Minimal gateway ref for tasks launched from web dashboard
  return {
    sendMessage: async () => { },
    sendImageMessage: async () => { },
    sendDocumentMessage: async () => { },
    sendTyping: async () => { },
  };
}

// ─── API: Status & Active Tasks ───────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  try {
    const { getAllActiveTasks } = require('./agyRunner');
    const tasks = getAllActiveTasks();
    const uptimeMin = Math.round(process.uptime() / 60);
    const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
    const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
    const usedMem = Math.round((totalMem - freeMem) * 10) / 10;
    res.json({
      connectionStatus,
      connectedUser: connectedUser ? { name: connectedUser.name, id: connectedUser.id } : null,
      uptimeMin,
      usedMem,
      totalMem,
      activeTasks: tasks
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Cancel Task ─────────────────────────────────────────────────────────
app.post('/api/task/cancel', (req, res) => {
  try {
    const { cancelTask } = require('./agyRunner');
    const { jid } = req.body;
    if (!jid) return res.status(400).json({ error: 'jid required' });
    const cancelled = cancelTask(jid);
    if (cancelled) {
      logger.info(`Task for ${jid} cancelled via Web Dashboard`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'No active task for this JID' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Start Task ──────────────────────────────────────────────────────────
app.post('/api/task/start', async (req, res) => {
  try {
    const { handleIncomingMessage } = require('./commandHandler');
    const { prompt, jid } = req.body;
    if (!prompt || !jid) return res.status(400).json({ error: 'prompt and jid required' });
    await handleIncomingMessage(jid, prompt, createDashboardGatewayRef());
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  if (connectionStatus === 'CONNECTED') {
    const uptimeMin = Math.round(process.uptime() / 60);
    const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
    const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
    const usedMem = Math.round((totalMem - freeMem) * 10) / 10;
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Raspberry Pi 5 CPU';
    const cpuCount = cpus.length;
    const selfJid = connectedUser?.id || '';

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AGY WhatsApp Gateway Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f172a; --card: #1e293b; --accent: #3b82f6;
      --green: #10b981; --red: #ef4444; --yellow: #f59e0b;
      --text: #f8fafc; --muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); margin: 0; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
    .header { width: 100%; background: rgba(30,41,59,0.8); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(255,255,255,0.1); padding: 20px 0; text-align: center; }
    .header h1 { margin: 0; font-size: 1.6rem; font-weight: 700; background: linear-gradient(135deg, #60a5fa, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .container { max-width: 960px; width: 90%; margin: 30px auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .card { background: var(--card); border-radius: 16px; padding: 24px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    .card.full-width { grid-column: 1 / -1; }
    .card h2 { font-size: 1rem; margin-top: 0; margin-bottom: 15px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
    .status-badge { display: inline-flex; align-items: center; padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; background: rgba(16,185,129,0.15); color: var(--green); border: 1px solid rgba(16,185,129,0.3); }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); margin-right: 8px; box-shadow: 0 0 8px var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .stat-val { font-size: 1.8rem; font-weight: 700; margin: 10px 0 5px; color: #fff; }
    .stat-label { font-size: 0.85rem; color: var(--muted); }
    .list-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.9rem; }
    .list-item:last-child { border-bottom: none; }
    #tasks-container { min-height: 40px; }
    .task-item { background: rgba(59,130,246,0.07); border: 1px solid rgba(59,130,246,0.2); border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .task-info { flex: 1; overflow: hidden; }
    .task-prompt { font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .task-meta { font-size: 0.78rem; color: var(--muted); margin-top: 4px; }
    .task-tool { font-size: 0.78rem; color: var(--yellow); margin-top: 3px; }
    .cancel-btn { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.4); color: var(--red); border-radius: 8px; padding: 6px 12px; font-size: 0.8rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background 0.2s; flex-shrink: 0; }
    .cancel-btn:hover { background: rgba(239,68,68,0.3); }
    .no-tasks { color: var(--muted); font-size: 0.9rem; padding: 8px 0; margin: 0; }
    .launch-form { display: flex; gap: 10px; flex-wrap: wrap; }
    .launch-form input { flex: 1; min-width: 200px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 10px 14px; color: var(--text); font-size: 0.9rem; font-family: 'Inter', sans-serif; outline: none; transition: border-color 0.2s; }
    .launch-form input:focus { border-color: var(--accent); }
    .launch-btn { background: linear-gradient(135deg, #3b82f6, #6366f1); border: none; border-radius: 10px; padding: 10px 20px; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
    .launch-btn:hover { opacity: 0.85; }
    #launch-status { margin-top: 10px; font-size: 0.85rem; min-height: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🍓 AGY WhatsApp Gateway Dashboard</h1>
    <p style="margin: 5px 0 0; color: var(--muted); font-size: 0.9rem;">Raspberry Pi 5 Server Daemon</p>
  </div>
  <div class="container">

    <div class="card">
      <h2>Connection Status</h2>
      <div class="status-badge"><div class="status-dot"></div> Connected &amp; Online</div>
      <div style="margin-top:15px;">
        <div class="list-item"><span>User Name:</span> <strong>${connectedUser?.name || 'WhatsApp User'}</strong></div>
        <div class="list-item"><span>User ID:</span> <strong>${connectedUser?.id ? connectedUser.id.split('@')[0] : 'Paired'}</strong></div>
        <div class="list-item"><span>Gateway Mode:</span> <strong>Self-Chat / Daemon</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>Raspberry Pi 5 Hardware</h2>
      <div class="stat-val">${usedMem} GB <span style="font-size:1rem;color:var(--muted);">/ ${totalMem} GB RAM</span></div>
      <div class="stat-label">Memory Usage</div>
      <div style="margin-top:15px;">
        <div class="list-item"><span>Processor:</span> <strong>${cpuCount} Cores (${cpuModel.slice(0, 20)})</strong></div>
        <div class="list-item"><span>Daemon Uptime:</span> <strong id="uptime">${uptimeMin} min</strong></div>
        <div class="list-item"><span>Platform:</span> <strong>${os.type()} ${os.arch()}</strong></div>
      </div>
    </div>

    <div class="card full-width">
      <h2>⚡ Active Execution Tasks <span id="task-count" style="color:var(--accent);font-size:0.85rem;"></span></h2>
      <div id="tasks-container"><p class="no-tasks">No tasks running.</p></div>
    </div>

    <div class="card full-width">
      <h2>🚀 Launch New AGY Task</h2>
      <div class="launch-form">
        <input type="text" id="launch-prompt" placeholder="Enter prompt..." autocomplete="off" />
        <button class="launch-btn" onclick="launchTask()">▶ Start Task</button>
      </div>
      <div id="launch-status"></div>
    </div>

  </div>
  <script>
    const SELF_JID = '${selfJid}';

    function fmt(ms) {
      const s = Math.floor(ms / 1000);
      return s < 60 ? s + 's' : Math.floor(s/60) + 'm ' + (s%60) + 's';
    }

    async function pollStatus() {
      try {
        const data = await fetch('/api/status').then(r => r.json());
        const tasks = data.activeTasks || [];
        document.getElementById('task-count').textContent = tasks.length ? '(' + tasks.length + ')' : '';
        const c = document.getElementById('tasks-container');
        if (!tasks.length) {
          c.innerHTML = '<p class="no-tasks">No tasks running.</p>';
        } else {
          c.innerHTML = tasks.map(t => \`
            <div class="task-item">
              <div class="task-info">
                <div class="task-prompt" title="\${t.prompt}">\${t.isGoal ? '🎯 ' : ''}\${t.prompt}</div>
                <div class="task-meta">⏱ \${fmt(t.durationMs)} &nbsp;|&nbsp; \${t.jid.split('@')[0]}\${t.btwCount ? ' &nbsp;|&nbsp; 💬 ' + t.btwCount + ' note(s)' : ''}</div>
                \${t.lastStatusText ? '<div class="task-tool">' + t.lastStatusText.replace(/\\*/g,'') + '</div>' : ''}
              </div>
              <button class="cancel-btn" onclick="cancelTask('\${t.jid}')">✖ Cancel</button>
            </div>\`).join('');
        }
        if (data.uptimeMin !== undefined) document.getElementById('uptime').textContent = data.uptimeMin + ' min';
      } catch(e) {}
    }

    async function cancelTask(jid) {
      await fetch('/api/task/cancel', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({jid}) }).catch(()=>{});
      pollStatus();
    }

    async function launchTask() {
      const input = document.getElementById('launch-prompt');
      const st = document.getElementById('launch-status');
      const prompt = input.value.trim();
      if (!prompt) return;
      st.style.color = '#94a3b8'; st.textContent = '⏳ Launching...';
      try {
        const data = await fetch('/api/task/start', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ prompt, jid: SELF_JID })
        }).then(r => r.json());
        if (data.success) {
          st.style.color = '#10b981'; st.textContent = '✅ Task launched!';
          input.value = '';
          setTimeout(pollStatus, 500);
        } else {
          st.style.color = '#ef4444'; st.textContent = '⚠ ' + (data.error || 'Failed');
        }
      } catch(e) {
        st.style.color = '#ef4444'; st.textContent = '⚠ ' + e.message;
      }
      setTimeout(() => { st.textContent = ''; }, 4000);
    }

    document.getElementById('launch-prompt').addEventListener('keydown', e => { if (e.key === 'Enter') launchTask(); });
    pollStatus();
    setInterval(pollStatus, 3000);
  </script>
</body>
</html>`);
    return;
  }

  if (!currentQrCode) {
    res.send(`<!DOCTYPE html>
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
  <p style="color:#94a3b8;">Generating QR Code, please wait...</p>
</body>
</html>`);
    return;
  }

  try {
    const qrDataUrl = await qrcode.toDataURL(currentQrCode);
    res.send(`<!DOCTYPE html>
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
    <p>Open WhatsApp &rarr; <b>Linked Devices</b> &rarr; <b>Link a Device</b> and scan:</p>
    <img src="${qrDataUrl}" alt="WhatsApp QR Code" width="260" height="260" />
    <p style="font-size:0.8rem;color:#64748b;">Page refreshes automatically every 15s</p>
  </div>
</body>
</html>`);
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
  setConnectionStatus,
  createDashboardGatewayRef
};
