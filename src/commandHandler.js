const fs = require('fs');
const logger = require('./logger');
const { markdownToWhatsApp, splitMessage } = require('./formatter');
const {
  startTask,
  cancelTask,
  isTaskRunning,
  getActiveTask,
  getAllActiveTasks,
  getAvailableModels
} = require('./agyRunner');

/**
 * Extracts generated or referenced image file paths from text.
 */
function extractImagePaths(text) {
  if (!text) return [];
  const found = new Set();

  // Pattern 1: Markdown image syntax ![alt](path)
  const mdImageRegex = /!\[.*?\]\((file:\/\/)?([^\s)]+\.(?:png|jpg|jpeg|webp))\)/gi;
  let match;
  while ((match = mdImageRegex.exec(text)) !== null) {
    const rawPath = match[2];
    if (fs.existsSync(rawPath)) {
      found.add(rawPath);
    }
  }

  // Pattern 2: File scheme file:///path/to/image.png
  const fileSchemeRegex = /file:\/\/(\/[^\s()]+\.(?:png|jpg|jpeg|webp))/gi;
  while ((match = fileSchemeRegex.exec(text)) !== null) {
    const rawPath = match[1];
    if (fs.existsSync(rawPath)) {
      found.add(rawPath);
    }
  }

  // Pattern 3: Absolute file paths in /tmp/ or /brain/ or /scratch/ or current dir
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
 * Handles incoming WhatsApp message text.
 * @param {string} jid WhatsApp chat remote JID
 * @param {string} text Message text
 * @param {object} gatewayRef Reference to Baileys gateway helper { sendMessage, sendImageMessage, sendTyping }
 */
async function handleIncomingMessage(jid, text, gatewayRef) {
  const cleanText = text.trim();
  if (!cleanText) return;

  const lowerText = cleanText.toLowerCase();

  // 1. Check if user wants to cancel current task
  if (lowerText === '/cancel' || lowerText === '!cancel') {
    const cancelled = cancelTask(jid);
    if (cancelled) {
      await gatewayRef.sendMessage(jid, '🛑 *Task cancelled successfully.*');
    } else {
      await gatewayRef.sendMessage(jid, 'ℹ️ No active task is currently running in this chat.');
    }
    return;
  }

  // 2. Check if a task is already running in this chat
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

  // 3. Handle explicit /btw when no task is running
  if (lowerText.startsWith('/btw ') || lowerText.startsWith('!btw ') || lowerText === '/btw' || lowerText === '!btw') {
    await gatewayRef.sendMessage(jid, 'ℹ️ No task is currently running. You can send a prompt directly or use `/goal <prompt>`.');
    return;
  }

  // 4. Handle /help
  if (lowerText === '/help' || lowerText === '!help' || lowerText === '/start') {
    const helpMessage = `
🚀 *AGY WhatsApp Gateway Commands*

• */goal <prompt>* - Run a long-running goal task with high reasoning effort & live updates
• */models* - List all available AI models on AGY
• */status* - Check gateway uptime, active tasks & connection status
• */cancel* - Cancel any active running task in this chat
• */btw <note>* - Add an in-between note to an active running task
• *<any prompt>* - Ask AGY anything directly (e.g. generate images, analyze files, code)

💡 *Pro-Tip:* If you ask AGY to generate an image, it will be sent directly to your WhatsApp chat as an image card!
`;
    await gatewayRef.sendMessage(jid, markdownToWhatsApp(helpMessage));
    return;
  }

  // 5. Handle /models
  if (lowerText === '/models' || lowerText === '!models') {
    await gatewayRef.sendTyping(jid);
    try {
      const modelsOutput = await getAvailableModels();
      const formattedModels = `🤖 *Available AGY Models:*\n\n\`\`\`\n${modelsOutput}\n\`\`\``;
      await gatewayRef.sendMessage(jid, markdownToWhatsApp(formattedModels));
    } catch (e) {
      await gatewayRef.sendMessage(jid, `❌ Failed to list models: ${e.message}`);
    }
    return;
  }

  // 6. Handle /status
  if (lowerText === '/status' || lowerText === '!status') {
    const activeTasks = getAllActiveTasks();
    const uptimeMin = Math.round(process.uptime() / 60);
    const statusMsg = `
📊 *AGY Gateway Status*

• *Connection:* ✅ Connected & Online
• *Uptime:* ${uptimeMin} minutes
• *Active Tasks:* ${activeTasks.length}
${activeTasks.map(t => `  - Chat: \`${t.jid}\` (Running: ${Math.round(t.durationMs / 1000)}s)`).join('\n')}
`;
    await gatewayRef.sendMessage(jid, markdownToWhatsApp(statusMsg));
    return;
  }

  // 7. Handle /goal <prompt>
  let isGoal = false;
  let prompt = cleanText;

  if (lowerText.startsWith('/goal ') || lowerText.startsWith('!goal ')) {
    isGoal = true;
    prompt = cleanText.slice(6).trim();
  }

  if (!prompt) {
    await gatewayRef.sendMessage(jid, '⚠️ Please provide a prompt for `/goal`. Example: `/goal build a web scraper`');
    return;
  }

  // 8. Start Prompt Execution with Interactive Progress
  const initialAck = isGoal
    ? '🎯 *Goal Task Received!* Initializing high-reasoning agent pipeline...\n_Send /cancel to stop, or reply with notes anytime._'
    : '⏳ *AGY is thinking...*\n_Send /cancel to stop, or reply with notes anytime._';

  await gatewayRef.sendMessage(jid, initialAck);
  await gatewayRef.sendTyping(jid);

  let lastProgressSent = Date.now();

  const options = {
    isGoal,
    effort: isGoal ? 'high' : undefined
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

        // Extract any generated image paths referenced in the response
        const imagePaths = extractImagePaths(finalResponse);

        // Format and send text response
        const formatted = markdownToWhatsApp(finalResponse);
        const chunks = splitMessage(formatted);

        for (let i = 0; i < chunks.length; i++) {
          await gatewayRef.sendMessage(jid, chunks[i]);
        }

        // Send generated image files natively as WhatsApp Image Cards
        if (gatewayRef.sendImageMessage && imagePaths.length > 0) {
          for (const imgPath of imagePaths) {
            await gatewayRef.sendImageMessage(jid, imgPath, '🎨 AGY Generated Image');
          }
        }
      },
      // onError callback
      async (err) => {
        await gatewayRef.sendTyping(jid, false);
        await gatewayRef.sendMessage(jid, `❌ *Error executing task:* ${err.message}`);
      }
    );
  } catch (err) {
    await gatewayRef.sendMessage(jid, `⚠️ ${err.message}`);
  }
}

module.exports = {
  handleIncomingMessage,
  extractImagePaths
};
