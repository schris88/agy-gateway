const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('./config');

const REMINDERS_FILE = path.join(config.authDir, 'reminders.json');
const activeReminders = new Map();

function parseTimeDelay(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().toLowerCase().match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hrs?|hours?|d|days?)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit.startsWith('s')) return value * 1000;
  if (unit.startsWith('m')) return value * 60 * 1000;
  if (unit.startsWith('h')) return value * 3600 * 1000;
  if (unit.startsWith('d')) return value * 86400 * 1000;

  return null;
}

function loadReminders(gatewayRef) {
  try {
    if (fs.existsSync(REMINDERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf-8'));
      const now = Date.now();

      data.forEach(item => {
        if (item.triggerTime > now) {
          const delay = item.triggerTime - now;
          scheduleReminderMemory(item, delay, gatewayRef);
        }
      });
      logger.info(`Loaded ${activeReminders.size} active reminder(s) from disk.`);
    }
  } catch (e) {
    logger.warn('Failed to load reminders.json');
  }
}

function saveRemindersDisk() {
  try {
    const list = Array.from(activeReminders.values()).map(r => ({
      id: r.id,
      jid: r.jid,
      message: r.message,
      createdAt: r.createdAt,
      triggerTime: r.triggerTime
    }));
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(list, null, 2));
  } catch (e) {
    logger.warn('Failed to save reminders.json');
  }
}

function scheduleReminderMemory(item, delayMs, gatewayRef) {
  const timerId = setTimeout(async () => {
    logger.info(`⏰ Firing reminder ${item.id} for ${item.jid}: "${item.message}"`);
    activeReminders.delete(item.id);
    saveRemindersDisk();

    if (gatewayRef && gatewayRef.sendMessage) {
      await gatewayRef.sendMessage(
        item.jid,
        `⏰ *AGY Reminder Alert!*\n\n📝 *Note:* ${item.message}`
      );
    }
  }, delayMs);

  activeReminders.set(item.id, {
    ...item,
    timer: timerId
  });
}

function addReminder(jid, timeStr, messageText, gatewayRef) {
  const delayMs = parseTimeDelay(timeStr);
  if (!delayMs) {
    throw new Error(`Invalid time format "${timeStr}". Use formats like \`10s\`, \`5m\`, \`2h\`, or \`1d\`.`);
  }

  const now = Date.now();
  const triggerTime = now + delayMs;
  const id = `rem_${Math.floor(Math.random() * 100000)}`;

  const item = {
    id,
    jid,
    message: messageText,
    createdAt: now,
    triggerTime
  };

  scheduleReminderMemory(item, delayMs, gatewayRef);
  saveRemindersDisk();

  return { id, delayMs, triggerTime };
}

function cancelReminder(id) {
  const item = activeReminders.get(id);
  if (!item) return false;

  clearTimeout(item.timer);
  activeReminders.delete(id);
  saveRemindersDisk();
  return true;
}

function getRemindersForJid(jid) {
  const results = [];
  activeReminders.forEach((r) => {
    if (r.jid === jid) {
      results.push(r);
    }
  });
  return results;
}

module.exports = {
  loadReminders,
  addReminder,
  cancelReminder,
  getRemindersForJid,
  parseTimeDelay
};
