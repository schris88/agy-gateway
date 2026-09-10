const { spawn } = require('child_process');
const readline = require('readline');
const logger = require('./logger');
const config = require('./config');

// Store running tasks by WhatsApp chat JID
const activeTasks = new Map();

/**
 * Spawns an AGY execution task.
 * @param {string} jid WhatsApp chat ID
 * @param {string} prompt Prompt string
 * @param {object} options Options like { effort: 'high', mode: 'plan', model: '...', isGoal: false, continueConvId: null }
 * @param {function} onProgress Callback for status updates (tool calls, thinking, btw notes)
 * @param {function} onComplete Callback on task success with final response text
 * @param {function} onError Callback on failure
 * @param {function} onCancel Optional callback on task cancellation
 */
function startTask(jid, prompt, options = {}, onProgress, onComplete, onError, onCancel) {
  if (activeTasks.has(jid)) {
    throw new Error('A task is already running in this chat. Please wait until it finishes or use /cancel to stop it.');
  }

  const args = [
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions'
  ];

  if (options.effort) {
    args.push('--effort', options.effort);
  }

  if (options.mode) {
    args.push('--mode', options.mode);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.continueConvId) {
    args.push('--conversation', options.continueConvId);
  }

  // Handle prompt argument
  args.push('-p', prompt);

  logger.info(`Starting AGY process for ${jid} with args: ${args.join(' ')}`);

  const child = spawn(config.agyBinPath, args, {
    cwd: config.workspaceDir,
    env: process.env
  });

  const taskState = {
    jid,
    prompt,
    child,
    startTime: Date.now(),
    isGoal: !!options.isGoal,
    conversationId: null,
    lastStatusText: '',
    fullText: '',
    cancelled: false,
    onCancel: onCancel || options.onCancel
  };

  activeTasks.set(jid, taskState);

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const data = JSON.parse(line.trim());
      handleStreamEvent(taskState, data, onProgress);
    } catch (e) {
      logger.warn({ line }, 'Failed to parse JSON stream line from agy');
    }
  });

  let stderrOutput = '';
  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  child.on('close', (code) => {
    activeTasks.delete(jid);

    if (taskState.cancelled) {
      logger.info(`Task for ${jid} was cancelled by user.`);
      return;
    }

    // Auto-retry once if authentication expired/required (token refresh in progress)
    if (code !== 0 && stderrOutput.includes('authentication required') && !options._isRetry) {
      logger.warn(`AGY auth error detected for ${jid}. Retrying in 1.5s after token refresh...`);
      setTimeout(() => {
        try {
          startTask(
            jid,
            prompt,
            { ...options, _isRetry: true },
            onProgress,
            onComplete,
            onError,
            onCancel
          );
        } catch (retryErr) {
          logger.error({ retryErr }, 'Failed to schedule AGY auth retry');
          onError(retryErr);
        }
      }, 1500);
      return;
    }

    if (code === 0 && taskState.fullText) {
      let finalAnswer = taskState.fullText.trim();
      onComplete(finalAnswer, taskState.conversationId, { tokenUsage: taskState.tokenUsage });
    } else if (code === 0 && !taskState.fullText) {
      onComplete("✅ Task finished with no text output.", taskState.conversationId, { tokenUsage: taskState.tokenUsage });
    } else {
      logger.error(`AGY process exited with code ${code}: ${stderrOutput}`);
      onError(new Error(`AGY process exited with code ${code}. ${stderrOutput.slice(-200)}`));
    }
  });

  child.on('error', (err) => {
    activeTasks.delete(jid);
    if (taskState.cancelled) return;
    logger.error({ err }, `Failed to start AGY binary for ${jid}`);
    onError(err);
  });

  return taskState;
}

function formatHumanReadableProgress(toolName, params = {}) {
  const clean = (val) => {
    if (!val || typeof val !== 'string') return '';
    let s = val.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      try { s = JSON.parse(s); } catch { s = s.slice(1, -1); }
    }
    return s.trim();
  };

  const summary = clean(params.toolSummary);
  const action = clean(params.toolAction);

  // Highest priority: Human-readable summary/action provided by AGY model
  if (summary && summary.length > 2) {
    return `⚙️ ${summary}`;
  }
  if (action && action.length > 2) {
    return `⚙️ ${action}`;
  }

  // Fallback heuristics per tool type
  switch (toolName) {
    case 'run_command': {
      const cmd = clean(params.CommandLine);
      if (/^sc\b/.test(cmd)) {
        const sub = cmd.split(/\s+/).slice(0, 3).join(' ');
        return `📊 Scalable Capital: ${sub}`;
      }
      if (/git\b/.test(cmd)) return '🔄 Synchronisiere Git-Repository';
      if (/curl\b/.test(cmd)) return '🌐 Führe Netzwerk-/API-Abfrage durch';
      if (/python/.test(cmd)) {
        const m = cmd.match(/[\w_-]+\.py/);
        return m ? `🐍 Führe Skript aus (${m[0]})` : '🐍 Führe Python-Code aus';
      }
      if (/ps |pgrep|pkill/.test(cmd)) return '🔍 Prüfe laufende Systemprozesse';
      if (/ls |find /.test(cmd)) return '📁 Durchsuche Dateien';
      if (/grep /.test(cmd)) return '🔎 Durchsuche Text/Dateien';
      const shortCmd = cmd.split('\n')[0].slice(0, 40);
      return `💻 Führe Befehl aus: ${shortCmd}`;
    }
    case 'view_file': {
      const p = clean(params.AbsolutePath) || clean(params.TargetFile);
      const file = p ? p.split('/').pop() : 'Datei';
      return `📄 Lese Datei ${file}`;
    }
    case 'replace_file_content': {
      const p = clean(params.TargetFile) || clean(params.AbsolutePath);
      const file = p ? p.split('/').pop() : 'Datei';
      return `✏️ Bearbeite Datei ${file}`;
    }
    case 'write_to_file': {
      const p = clean(params.TargetFile) || clean(params.AbsolutePath);
      const file = p ? p.split('/').pop() : 'Datei';
      return `📝 Erstelle Datei ${file}`;
    }
    case 'search_web': {
      const q = clean(params.query || params.Query);
      return `🔍 Web-Suche: "${q.slice(0, 45)}"`;
    }
    case 'read_url_content': {
      const url = clean(params.Url || params.URL || params.url);
      try {
        const host = new URL(url).hostname;
        return `🌐 Lese Webseite (${host})`;
      } catch {
        return '🌐 Lese Web-Inhalte';
      }
    }
    case 'find_by_name': {
      const pat = clean(params.Pattern);
      return `🔎 Suche Dateien (${pat || 'Pattern'})`;
    }
    case 'grep_search': {
      const q = clean(params.Query);
      return `🔎 Durchsuche Code: "${q.slice(0, 35)}"`;
    }
    case 'list_dir': {
      const dir = clean(params.DirectoryPath);
      const dirName = dir ? dir.split('/').pop() || dir : 'Verzeichnis';
      return `📂 Lese Verzeichnis ${dirName}`;
    }
    case 'manage_task': {
      const act = clean(params.Action);
      return `⏱️ Verwalte Hintergrundaufgabe (${act || 'Status'})`;
    }
    case 'call_mcp_tool': {
      const srv = clean(params.ServerName);
      const tool = clean(params.ToolName);
      return `🔌 Tool: ${srv} / ${tool}`;
    }
    default:
      return `🛠️ Führe ${toolName} aus`;
  }
}

function handleStreamEvent(taskState, data, onProgress) {
  if (taskState.cancelled) return;

  if (data.event === 'init' && data.conversation_id) {
    taskState.conversationId = data.conversation_id;
  }

  if (data.event === 'step_update') {
    const step = data.step_update;

    if (step.state === 'ACTIVE' && step.step_type === 'tool') {
      const toolName = step.tool_name || (step.tool_info && step.tool_info.name) || 'unknown tool';
      const params = (step.tool_info && step.tool_info.parameters) || {};
      const statusMsg = formatHumanReadableProgress(toolName, params);
      if (statusMsg && statusMsg !== taskState.lastStatusText) {
        taskState.lastStatusText = statusMsg;
        if (onProgress) onProgress(statusMsg);
      }
    }

    if (step.text_delta) {
      taskState.fullText += step.text_delta;
    }
  }

  if (data.event === 'result' && data.result) {
    if (data.result.response) {
      taskState.fullText = data.result.response;
    }
    if (data.result.usage || data.result.token_usage) {
      taskState.tokenUsage = data.result.usage || data.result.token_usage;
    }
  }
}

/**
 * Cancels a running task for a specific chat JID
 */
function cancelTask(jid) {
  const task = activeTasks.get(jid);
  if (!task) {
    return false;
  }

  task.cancelled = true;

  if (typeof task.onCancel === 'function') {
    try {
      task.onCancel();
    } catch (e) {
      logger.warn(`Error executing task onCancel for ${jid}: ${e.message}`);
    }
  }

  if (task.child) {
    logger.info(`Killing process ${task.child.pid} for chat ${jid}`);
    task.child.kill('SIGTERM');
    setTimeout(() => {
      if (task.child && !task.child.killed) {
        try {
          task.child.kill('SIGKILL');
        } catch (e) {}
      }
    }, 2000);
  }
  activeTasks.delete(jid);
  return true;
}

/**
 * Checks if a task is running for a JID
 */
function isTaskRunning(jid) {
  return activeTasks.has(jid);
}

/**
 * Gets running task info for a JID
 */
function getActiveTask(jid) {
  return activeTasks.get(jid);
}

/**
 * Lists all active tasks across all chats
 */
function getAllActiveTasks() {
  const tasks = [];
  activeTasks.forEach((task, jid) => {
    tasks.push({
      jid,
      prompt: task.prompt,
      isGoal: task.isGoal,
      durationMs: Date.now() - task.startTime,
      conversationId: task.conversationId,
      lastStatusText: task.lastStatusText || ''
    });
  });
  return tasks;
}

module.exports = {
  startTask,
  cancelTask,
  isTaskRunning,
  getActiveTask,
  getAllActiveTasks
};
