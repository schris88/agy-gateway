const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('./config');

const FEEDBACK_FILE = path.join(config.authDir, 'feedback_memory.json');
const OBSIDIAN_MEMORY_FILE = '/Users/christianstengel/Documents/Obsidian Vault/antigravity_memory.md';

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

  // If positive reaction (👍, ❤️, 🔥), mirror note to Obsidian Vault
  if (['👍', '❤️', '🔥', '💡'].includes(emoji)) {
    try {
      if (fs.existsSync(OBSIDIAN_MEMORY_FILE)) {
        const dateStr = new Date().toISOString().split('T')[0];
        const noteLine = `- **[User Feedback ${dateStr}]**: User reacted with ${emoji} to AGY response: "${textSnippet.slice(0, 150)}..."\n`;
        let content = fs.readFileSync(OBSIDIAN_MEMORY_FILE, 'utf-8');

        if (!content.includes(textSnippet.slice(0, 50))) {
          // Append before last line
          const marker = '*Zuletzt aktualisiert:';
          if (content.includes(marker)) {
            content = content.replace(marker, `${noteLine}\n${marker}`);
          } else {
            content += `\n${noteLine}`;
          }
          fs.writeFileSync(OBSIDIAN_MEMORY_FILE, content);
          logger.info('Updated Obsidian Vault memory with user reaction feedback.');
        }
      }
    } catch (e) {
      logger.warn(`Could not update Obsidian memory vault: ${e.message}`);
    }
  }

  return entry;
}

module.exports = {
  recordEmojiFeedback,
  loadFeedback
};
