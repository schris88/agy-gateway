const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('./config');
const { markdownToWhatsApp, splitMessage } = require('./formatter');
const {
  startTask,
  cancelTask,
  isTaskRunning,
  getActiveTask,
  getAllActiveTasks
} = require('./agyRunner');
const {
  addReminder,
  cancelReminder,
  getRemindersForJid,
  parseTimeDelay
} = require('./scheduler');

const SESSIONS_FILE = path.join(config.authDir, 'chat_sessions.json');
const chatSessions = new Map();

// Load sessions from disk
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
      Object.keys(data).forEach(jid => {
        chatSessions.set(jid, data[jid]);
      });
      logger.info(`Loaded ${chatSessions.size} active chat session(s) from disk.`);
    }
  } catch (e) {
    logger.warn('Failed to load chat_sessions.json');
  }
}

// Save sessions to disk
function saveSessions() {
  try {
    const data = {};
    chatSessions.forEach((val, jid) => {
      data[jid] = val;
    });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.warn('Failed to save chat_sessions.json');
  }
}

// Load sessions on module import
loadSessions();

/**
 * Parses error messages to detect rate limits / 429 errors and extract wait time.
 */
function parseRateLimitWaitTime(errorMsg) {
  if (!errorMsg) return { isRateLimit: false, waitMs: 60000 };

  const lower = errorMsg.toLowerCase();
  const isRateLimit = lower.includes('429') ||
                      lower.includes('rate limit') ||
                      lower.includes('resource_exhausted') ||
                      lower.includes('quota') ||
                      lower.includes('too many requests');

  if (!isRateLimit) {
    return { isRateLimit: false, waitMs: 60000 };
  }

  let waitMs = 60000;

  const secMatch = lower.match(/(?:retry after|try again in|wait)\s*(\d+)\s*(?:sec|second|s)/);
  if (secMatch && secMatch[1]) {
    waitMs = parseInt(secMatch[1], 10) * 1000;
  } else {
    const minMatch = lower.match(/(?:retry after|try again in|wait)\s*(\d+)\s*(?:min|minute|m)/);
    if (minMatch && minMatch[1]) {
      waitMs = parseInt(minMatch[1], 10) * 60 * 1000;
    }
  }

  waitMs = Math.max(15000, Math.min(waitMs, 3600000));
  return { isRateLimit: true, waitMs };
}

/**
 * Extracts generated or referenced image file paths from text.
 */
function extractImagePaths(text) {
  if (!text) return [];
  const found = new Set();

  const mdImageRegex = /!\[.*?\]\((file:\/\/)?([^\s)]+\.(?:png|jpg|jpeg|webp))\)/gi;
  let match;
  while ((match = mdImageRegex.exec(text)) !== null) {
    const rawPath = match[2];
    if (fs.existsSync(rawPath)) {
      found.add(rawPath);
    }
  }

  const fileSchemeRegex = /file:\/\/(\/[^\s()]+\.(?:png|jpg|jpeg|webp))/gi;
  while ((match = fileSchemeRegex.exec(text)) !== null) {
    const rawPath = match[1];
    if (fs.existsSync(rawPath)) {
      found.add(rawPath);
    }
  }

  const pathRegex = /(\/(?:tmp|[^\s()]+\/brain\/[^\s()]+|[^\s()]+\/scratch\/[^\s()]+|[^\s()]+)\/[^\s()]+\.(?:png|jpg|jpeg|webp))/gi;
  while ((match = pathRegex.exec(text)) !== null) {
    const rawPath = match[1];
    if (fs.existsSync(rawPath)) {
      found.add(rawPath);
    }
  }

  return Array.from(found);
}

/**
 * Scans the AGY conversation brain folder for image files generated during a task.
 */
function findGeneratedImagesForTask(convId, startTime) {
  if (!convId) return [];
  const found = new Set();

  const homeDir = process.env.HOME || '/home/sxlib';
  const brainDir = path.join(homeDir, '.gemini/antigravity-cli/brain', convId);

  if (fs.existsSync(brainDir)) {
    try {
      const files = fs.readdirSync(brainDir);
      for (const file of files) {
        if (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.webp')) {
          const filePath = path.join(brainDir, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs >= startTime - 10000) {
            found.add(filePath);
          }
        }
      }
    } catch (e) {
      logger.warn(`Error scanning brain dir ${brainDir}: ${e.message}`);
    }
  }

  return Array.from(found);
}

/**
 * Handles incoming WhatsApp message text.
 * @param {string} jid WhatsApp chat remote JID
 * @param {string} text Message text
 * @param {object} gatewayRef Reference to Baileys gateway helper { sendMessage, sendImageMessage, sendDocumentMessage, sendTyping }
 */
async function handleIncomingMessage(jid, text, gatewayRef) {
  const cleanText = text.trim();
  if (!cleanText) return;

  const lowerText = cleanText.toLowerCase();

  // 1. Check if user wants to reset conversation history for this chat
  if (lowerText === '/reset' || lowerText === '!reset' || lowerText === '/clear' || lowerText === '!clear' || lowerText === '/new') {
    chatSessions.delete(jid);
    saveSessions();
    await gatewayRef.sendMessage(jid, '🧹 *AGY Conversation Session Reset!* Starting a new fresh session.');
    return;
  }

  // 2. Check if user wants to cancel current task
  if (lowerText === '/cancel' || lowerText === '!cancel') {
    const cancelled = cancelTask(jid);
    if (cancelled) {
      await gatewayRef.sendMessage(jid, '🛑 *AGY Task cancelled successfully.*');
    } else {
      await gatewayRef.sendMessage(jid, 'ℹ️ No active task is currently running in this chat.');
    }
    return;
  }

  // 3. Handle /export <file_path>
  if (lowerText.startsWith('/export ') || lowerText.startsWith('!export ')) {
    const targetPath = cleanText.slice(8).trim();
    if (!targetPath) {
      await gatewayRef.sendMessage(jid, '⚠️ Usage: `/export <absolute_or_relative_file_path>` (e.g. `/export README.md`)');
      return;
    }

    const resolvedPath = path.resolve(targetPath);
    if (!fs.existsSync(resolvedPath)) {
      await gatewayRef.sendMessage(jid, `❌ File not found at path: \`${resolvedPath}\``);
      return;
    }

    if (gatewayRef.sendDocumentMessage) {
      await gatewayRef.sendDocumentMessage(jid, resolvedPath, `📄 *Exported File:* ${path.basename(resolvedPath)}`);
    } else {
      await gatewayRef.sendMessage(jid, `❌ Document sending function is not available.`);
    }
    return;
  }

  // 4. Handle /remind
  if (lowerText.startsWith('/remind') || lowerText.startsWith('!remind')) {
    const argsStr = cleanText.slice(7).trim();

    if (!argsStr || argsStr === 'list') {
      const list = getRemindersForJid(jid);
      if (list.length === 0) {
        await gatewayRef.sendMessage(jid, 'ℹ️ No active scheduled reminders for this chat.');
        return;
      }
      const itemsText = list.map(r => {
        const remainingSec = Math.round((r.triggerTime - Date.now()) / 1000);
        return `• ID: \`${r.id}\` — "${r.message}" (in ~${remainingSec}s)`;
      }).join('\n');
      await gatewayRef.sendMessage(jid, `⏰ *Active Reminders:*\n\n${itemsText}`);
      return;
    }

    if (argsStr.startsWith('cancel ')) {
      const idToCancel = argsStr.slice(7).trim();
      const ok = cancelReminder(idToCancel);
      if (ok) {
        await gatewayRef.sendMessage(jid, `✅ Reminder \`${idToCancel}\` cancelled.`);
      } else {
        await gatewayRef.sendMessage(jid, `❌ Reminder \`${idToCancel}\` not found.`);
      }
      return;
    }

    // Format: /remind <timeStr> <message>
    const firstSpaceIndex = argsStr.indexOf(' ');
    if (firstSpaceIndex === -1) {
      await gatewayRef.sendMessage(jid, '⚠️ Usage: `/remind <time> <message>`\nExample: `/remind 10m Check deployment status`');
      return;
    }

    const timeStr = argsStr.slice(0, firstSpaceIndex).trim();
    const reminderMsg = argsStr.slice(firstSpaceIndex + 1).trim();

    try {
      const { id, delayMs } = addReminder(jid, timeStr, reminderMsg, gatewayRef);
      const secondsSec = Math.round(delayMs / 1000);
      const minutesMin = Math.round(delayMs / 60000);
      const displayTime = minutesMin >= 1 ? `${minutesMin} min` : `${secondsSec} sec`;

      await gatewayRef.sendMessage(
        jid,
        `⏰ *Reminder Scheduled!*\n\n• *ID:* \`${id}\`\n• *Time:* in ~${displayTime}\n• *Note:* "${reminderMsg}"`
      );
    } catch (err) {
      await gatewayRef.sendMessage(jid, `❌ ${err.message}`);
    }
    return;
  }

  // 5. Check if a task is already running in this chat
  if (isTaskRunning(jid)) {
    let btwNote = cleanText;
    if (lowerText.startsWith('/btw ') || lowerText.startsWith('!btw ')) {
      btwNote = cleanText.slice(5).trim();
    }

    try {
      startTask(jid, btwNote, { isBtw: true }, (progressMsg) => {
        gatewayRef.sendMessage(jid, progressMsg);
      });
    } catch (err) {
      await gatewayRef.sendMessage(jid, `⚠️ ${err.message}`);
    }
    return;
  }

  // 6. Handle explicit /btw when no task is running
  if (lowerText.startsWith('/btw ') || lowerText.startsWith('!btw ') || lowerText === '/btw' || lowerText === '!btw') {
    await gatewayRef.sendMessage(jid, 'ℹ️ No task is currently running. You can send a prompt directly or use `/goal <prompt>`.');
    return;
  }

  // 7. Handle /help
  if (lowerText === '/help' || lowerText === '!help' || lowerText === '/start') {
    const session = chatSessions.get(jid);
    const hasHistory = !!session?.conversationId;

    const helpMessage = `
🚀 *Native AGY Slash Commands & Functions*

• */goal <prompt>* - Long-running goal task with high reasoning effort & live updates
• */plan <prompt>* - Step-by-step plan execution mode
• */remind <time> <msg>* - Schedule reminder alert (e.g. \`/remind 10m Check server\`)
• */export <file_path>* - Send file directly as WhatsApp document attachment
• */models* - Native AGY models (Gemini 3.6 Flash, Gemini 3.1 Pro, Claude Sonnet 4-6)
• */agents* - Native AGY subagents (research, self)
• */skills* or */plugins* - Installed AGY skills & plugin extensions
• */status* - Gateway status, active chat session & uptime
• */reset* or */clear* - Clear chat history & start fresh AGY session
• */cancel* - Cancel active running task
• */btw <note>* - Inject mid-task update
• *<slash skill, e.g. /caveman, /learn>* - All AGY slash skills work directly!

💡 *AGY Context Memory:* ${hasHistory ? '🧠 *Active session memory enabled*' : '🆕 *New session*'}
`;
    await gatewayRef.sendMessage(jid, markdownToWhatsApp(helpMessage));
    return;
  }

  // 8. Handle /models (Native AGY CLI Context)
  if (lowerText === '/models' || lowerText === '!models') {
    const modelsMessage = `
🤖 *Native AGY Models*

• *Gemini 3.6 Flash* (low | medium | high effort) - Default fast reasoning engine
• *Gemini 3.1 Pro* (low | medium | high effort) - Deep reasoning & complex architecture
• *Claude Sonnet 4-6* - Anthropic Sonnet model via AGY backend
`;
    await gatewayRef.sendMessage(jid, markdownToWhatsApp(modelsMessage));
    return;
  }

  // 9. Handle /agents (Native AGY Subagents)
  if (lowerText === '/agents' || lowerText === '!agents' || lowerText === '/agent') {
    const agentsMessage = `
👥 *Native AGY Subagents*

• *research* - Read-only subagent for codebase exploration & web research
• *self* - Subagent inheriting full parent tools, system prompt & configuration
`;
    await gatewayRef.sendMessage(jid, markdownToWhatsApp(agentsMessage));
    return;
  }

  // 10. Handle /skills or /plugins (Complete Uncut Listing)
  if (lowerText === '/skills' || lowerText === '!skills' || lowerText === '/plugins' || lowerText === '!plugins') {
    await gatewayRef.sendMessage(jid, '🛠️ *Fetching complete list of installed AGY Skills & Plugins...*\n_Inspecting all skill manifests..._');
    await gatewayRef.sendTyping(jid);

    const existingSession = chatSessions.get(jid);
    const continueConvId = existingSession ? existingSession.conversationId : null;
    let lastProgressSent = Date.now();

    try {
      startTask(
        jid,
        "List EVERY single installed AGY skill and plugin in this workspace as a full, complete, un-truncated bulleted list with their exact name and short description. Do NOT summarize or omit any skills.",
        { continueConvId },
        async (progressText) => {
          const now = Date.now();
          if (now - lastProgressSent > 3500) {
            lastProgressSent = now;
            await gatewayRef.sendMessage(jid, markdownToWhatsApp(progressText));
            await gatewayRef.sendTyping(jid);
          }
        },
        async (finalResponse) => {
          await gatewayRef.sendTyping(jid, false);
          const formatted = markdownToWhatsApp(`🛠️ *Complete Installed AGY Skills & Plugins:*\n\n${finalResponse}`);
          const chunks = splitMessage(formatted, 3800);
          for (let i = 0; i < chunks.length; i++) {
            await gatewayRef.sendMessage(jid, chunks[i]);
          }
        },
        async (err) => {
          await gatewayRef.sendTyping(jid, false);
          const { isRateLimit, waitMs } = parseRateLimitWaitTime(err.message);

          if (isRateLimit) {
            const waitMin = Math.ceil(waitMs / 60000);
            const waitSec = Math.ceil((waitMs % 60000) / 1000);
            const timeStr = waitMin > 1 ? `${waitMin} minutes` : `${waitSec} seconds`;

            await gatewayRef.sendMessage(
              jid,
              `⏳ *Rate Limit / Quota Exhausted!*\n\nAGY hit an API rate limit window: \`${err.message.slice(0, 150)}\`\n\n⏸️ *Pausing for ~${timeStr}.* I will automatically send you a notification as soon as the limit clears!`
            );

            setTimeout(async () => {
              await gatewayRef.sendMessage(
                jid,
                `✅ *Rate Limit Window Cleared!*\n\nAGY rate limit has expired. You can continue sending prompts and commands now!`
              );
            }, waitMs);
          } else {
            await gatewayRef.sendMessage(jid, `❌ *Failed to list skills:* ${err.message}`);
          }
        }
      );
    } catch (e) {
      await gatewayRef.sendMessage(jid, `❌ Failed to list skills: ${e.message}`);
    }
    return;
  }

  // 11. Handle /status
  if (lowerText === '/status' || lowerText === '!status') {
    const activeTasks = getAllActiveTasks();
    const uptimeMin = Math.round(process.uptime() / 60);
    const session = chatSessions.get(jid);

    const statusMsg = `
📊 *AGY Gateway Status*

• *Connection:* ✅ Connected & Online
• *Uptime:* ${uptimeMin} minutes
• *Active Chat Memory:* ${session?.conversationId ? `\`${session.conversationId}\`` : 'None (New)'}
• *Active Tasks:* ${activeTasks.length}
${activeTasks.map(t => `  - Chat: \`${t.jid}\` (Running: ${Math.round(t.durationMs / 1000)}s)`).join('\n')}
`;
    await gatewayRef.sendMessage(jid, markdownToWhatsApp(statusMsg));
    return;
  }

  // 12. Handle /goal or /plan or general slash prompt
  let isGoal = false;
  let mode = undefined;
  let prompt = cleanText;

  if (lowerText.startsWith('/goal ') || lowerText.startsWith('!goal ')) {
    isGoal = true;
    prompt = cleanText.slice(6).trim();
  } else if (lowerText.startsWith('/plan ') || lowerText.startsWith('!plan ')) {
    mode = 'plan';
    prompt = cleanText.slice(6).trim();
  }

  if (!prompt) {
    await gatewayRef.sendMessage(jid, '⚠️ Please provide a prompt. Example: `/goal build a web scraper` or `/plan design architecture`');
    return;
  }

  // Retrieve active session conversation ID for multi-turn history continuity
  const existingSession = chatSessions.get(jid);
  const continueConvId = existingSession ? existingSession.conversationId : null;
  const taskStartTime = Date.now();

  // 13. Start Prompt Execution with Interactive Progress
  const modeLabel = isGoal ? 'Goal Task' : (mode === 'plan' ? 'Plan Task' : 'Task');
  const initialAck = `⏳ *AGY ${modeLabel} Received!* Initializing agent pipeline...\n_${continueConvId ? 'Continuing AGY session' : 'New AGY session'}. Send /cancel to stop, or reply with notes anytime._`;

  await gatewayRef.sendMessage(jid, initialAck);
  await gatewayRef.sendTyping(jid);

  let lastProgressSent = Date.now();

  const options = {
    isGoal,
    effort: isGoal ? 'high' : undefined,
    mode,
    continueConvId
  };

  try {
    startTask(
      jid,
      prompt,
      options,
      // onProgress callback
      async (progressText) => {
        const now = Date.now();
        if (now - lastProgressSent > 3500 || progressText.includes('Added note')) {
          lastProgressSent = now;
          await gatewayRef.sendMessage(jid, markdownToWhatsApp(progressText));
          await gatewayRef.sendTyping(jid);
        }
      },
      // onComplete callback
      async (finalResponse, convId) => {
        await gatewayRef.sendTyping(jid, false);

        // Update persistent conversation session memory
        if (convId) {
          chatSessions.set(jid, {
            conversationId: convId,
            lastUpdated: Date.now()
          });
          saveSessions();
        }

        // Extract image paths referenced in text AND generated inside AGY brain directory
        const textImagePaths = extractImagePaths(finalResponse);
        const brainImagePaths = findGeneratedImagesForTask(convId, taskStartTime);
        const allImagePaths = Array.from(new Set([...textImagePaths, ...brainImagePaths]));

        // Format and send text response
        const formatted = markdownToWhatsApp(finalResponse);
        const chunks = splitMessage(formatted, 3800);

        for (let i = 0; i < chunks.length; i++) {
          await gatewayRef.sendMessage(jid, chunks[i]);
        }

        // Send all generated image files natively as WhatsApp Image Cards
        if (gatewayRef.sendImageMessage && allImagePaths.length > 0) {
          for (const imgPath of allImagePaths) {
            logger.info(`Sending task image to ${jid}: ${imgPath}`);
            await gatewayRef.sendImageMessage(jid, imgPath, '🎨 AGY Generated Image');
          }
        }
      },
      // onError callback
      async (err) => {
        await gatewayRef.sendTyping(jid, false);
        const { isRateLimit, waitMs } = parseRateLimitWaitTime(err.message);

        if (isRateLimit) {
          const waitMin = Math.ceil(waitMs / 60000);
          const waitSec = Math.ceil((waitMs % 60000) / 1000);
          const timeStr = waitMin > 1 ? `${waitMin} minutes` : `${waitSec} seconds`;

          await gatewayRef.sendMessage(
            jid,
            `⏳ *Rate Limit / Quota Exhausted!*\n\nAGY reached an API rate limit window: \`${err.message.slice(0, 150)}\`\n\n⏸️ *Pausing for ~${timeStr}.* I will automatically send you a notification as soon as the limit clears!`
          );

          setTimeout(async () => {
            await gatewayRef.sendMessage(
              jid,
              `✅ *Rate Limit Window Cleared!*\n\nAGY rate limit has expired. You can continue sending prompts and commands now!`
            );
          }, waitMs);
        } else {
          await gatewayRef.sendMessage(jid, `❌ *Error executing task:* ${err.message}`);
        }
      }
    );
  } catch (err) {
    await gatewayRef.sendMessage(jid, `⚠️ ${err.message}`);
  }
}

module.exports = {
  handleIncomingMessage,
  extractImagePaths,
  findGeneratedImagesForTask,
  parseRateLimitWaitTime
};
