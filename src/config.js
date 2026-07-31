const path = require('path');
const fs = require('fs');
const execSync = require('child_process').execSync;
require('dotenv').config();

function findAgyBinary() {
  if (process.env.AGY_BIN_PATH && fs.existsSync(process.env.AGY_BIN_PATH)) {
    return process.env.AGY_BIN_PATH;
  }
  const defaultMacPath = path.join(process.env.HOME || '', '.local/bin/agy');
  if (fs.existsSync(defaultMacPath)) {
    return defaultMacPath;
  }
  try {
    const whichPath = execSync('which agy', { encoding: 'utf-8' }).trim();
    if (whichPath && fs.existsSync(whichPath)) {
      return whichPath;
    }
  } catch (e) {
    // Ignore error if which fails
  }
  return 'agy'; // Fallback to PATH
}

const allowedNumbersRaw = process.env.WHATSAPP_ALLOWED_NUMBERS || '';

const config = {
  agyBinPath: findAgyBinary(),
  whatsappAllowSelf: process.env.WHATSAPP_ALLOW_SELF !== 'false', // Default true for self chat
  whatsappAllowGroups: process.env.WHATSAPP_ALLOW_GROUPS === 'true', // Default false (ignore group chats)
  whatsappAllowedNumbers: allowedNumbersRaw === '*'
    ? ['*']
    : allowedNumbersRaw
        .split(',')
        .map(n => n.trim().replace(/[^0-9*]/g, ''))
        .filter(Boolean),
  port: parseInt(process.env.PORT || '3000', 10),
  authDir: path.resolve(process.env.AUTH_DIR || './auth_info_baileys'),
  workspaceDir: path.resolve(process.env.WORKSPACE_DIR || process.cwd()),
  progressIntervalMs: parseInt(process.env.PROGRESS_INTERVAL_MS || '4000', 10),
  maxMessageLength: 4000,
};

module.exports = config;
