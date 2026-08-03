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
    const existing = activeTasks.get(jid);
    if (options.isBtw) {
      existing.btwNotes.push(prompt);
      logger.info(`Added /btw note to active task for ${jid}: ${prompt}`);
      if (onProgress) {
        onProgress(`💬 *Added note to active task:* "${prompt}"`);
      }
      return existing;
    } else {
      throw new Error('A task is already running in this chat. Use /cancel to stop it or send a note with /btw.');
    }
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
    btwNotes: [],
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

    if (code === 0 && taskState.fullText) {
      let finalAnswer = taskState.fullText.trim();
      if (taskState.btwNotes.length > 0) {
        finalAnswer += `\n\n_Note: Interrupted with ${taskState.btwNotes.length} /btw update(s)._`;
      }
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

function handleStreamEvent(taskState, data, onProgress) {
  if (taskState.cancelled) return;

  if (data.event === 'init' && data.conversation_id) {
    taskState.conversationId = data.conversation_id;
  }

  if (data.event === 'step_update') {
    const step = data.step_update;

    if (step.state === 'ACTIVE' && step.step_type === 'tool') {
      const toolName = step.tool_name || (step.tool_info && step.tool_info.name) || 'unknown tool';
      let paramDesc = '';
      if (step.tool_info && step.tool_info.parameters) {
        const params = step.tool_info.parameters;
        if (params.CommandLine) paramDesc = `: \`${params.CommandLine.slice(0, 60)}\``;
        else if (params.Query || params.query) paramDesc = `: \`${params.Query || params.query}\``;
        else if (params.TargetFile) paramDesc = `: \`${params.TargetFile.split('/').pop()}\``;
        else if (params.AbsolutePath) paramDesc = `: \`${params.AbsolutePath.split('/').pop()}\``;
        else if (params.Url || params.URL || params.url) paramDesc = `: \`${params.Url || params.URL || params.url}\``;
        else if (params.prompt || params.Prompt) paramDesc = `: \`${(params.prompt || params.Prompt).slice(0, 50)}\``;
      }
      const statusMsg = `🛠️ *Tool:* \`${toolName}\`${paramDesc}`;
      if (statusMsg !== taskState.lastStatusText) {
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
      btwCount: task.btwNotes.length,
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
