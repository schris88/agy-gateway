const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const logger = require('./logger');
const config = require('./config');

const FEEDBACK_FILE = path.join(config.authDir, 'feedback_memory.json');

function findObsidianMemoryPath() {
  if (process.env.OBSIDIAN_MEMORY_PATH && fs.existsSync(process.env.OBSIDIAN_MEMORY_PATH)) {
    return process.env.OBSIDIAN_MEMORY_PATH;
  }

  const possiblePaths = [
    path.join(process.env.HOME || '', 'Documents/Obsidian Vault/antigravity_memory.md'),
    '/Users/christianstengel/Documents/Obsidian Vault/antigravity_memory.md',
    '/home/sxlib/Documents/Obsidian Vault/antigravity_memory.md'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function loadFeedback() {
  try {
    if (fs.existsSync(FEEDBACK_FILE)) {
      return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf-8'));
    }
  } catch (e) {
    logger.warn('Failed to read feedback_memory.json');
  }
  return [];
}

function saveFeedback(feedbackList) {
  try {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedbackList, null, 2));
  } catch (e) {
    logger.warn('Failed to write feedback_memory.json');
  }
}

function recordEmojiFeedback(msgId, emoji, textSnippet = '') {
  const list = loadFeedback();
  const entry = {
    id: `fb_${Date.now()}`,
    msgId,
    emoji,
    textSnippet: textSnippet.slice(0, 300),
    timestamp: Date.now()
  };

  list.push(entry);
  saveFeedback(list);
  logger.info(`👍 Recorded WhatsApp reaction ${emoji} for msg ${msgId}`);

  // If positive reaction (👍, ❤️, 🔥, 💡), mirror note to Obsidian Vault
  if (['👍', '❤️', '🔥', '💡', '📌'].includes(emoji)) {
    const memoryPath = findObsidianMemoryPath();
    if (memoryPath) {
      try {
        const dateStr = new Date().toISOString().split('T')[0];
        const noteLine = `- **[User Feedback ${dateStr}]**: User reacted with ${emoji} to AGY response: "${textSnippet.slice(0, 150)}..."\n`;
        let content = fs.readFileSync(memoryPath, 'utf-8');

        if (!content.includes(textSnippet.slice(0, 40))) {
          const marker = '*Zuletzt aktualisiert:';
          if (content.includes(marker)) {
            content = content.replace(marker, `${noteLine}\n${marker}`);
          } else {
            content += `\n${noteLine}`;
          }
          fs.writeFileSync(memoryPath, content);
          logger.info(`Updated Obsidian Vault memory at ${memoryPath} with user reaction feedback.`);

          // Commit and push Obsidian Vault if git repo
          const vaultDir = path.dirname(memoryPath);
          exec(`cd "${vaultDir}" && git add antigravity_memory.md && git commit -m "docs: user reaction feedback ${emoji}" && git push`, (err) => {
            if (err) logger.warn(`Git push for Obsidian memory failed: ${err.message}`);
            else logger.info('Successfully committed and pushed positive feedback to Obsidian Vault git repo.');
          });
        }
      } catch (e) {
        logger.warn(`Could not update Obsidian memory vault: ${e.message}`);
      }
    }
  }

  return entry;
}

module.exports = {
  recordEmojiFeedback,
  loadFeedback,
  findObsidianMemoryPath
};
