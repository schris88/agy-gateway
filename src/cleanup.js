const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Default max age: 7 days (604800000 ms)
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cleans temporary WhatsApp media files from /tmp directory.
 */
function cleanTmpMediaFiles(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const tmpDir = '/tmp';
  let removedCount = 0;
  let freedBytes = 0;
  const now = Date.now();

  try {
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        if (file.startsWith('whatsapp_')) {
          const filePath = path.join(tmpDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs >= maxAgeMs) {
              freedBytes += stat.size;
              fs.unlinkSync(filePath);
              removedCount++;
            }
          } catch (e) {
            // Ignore file read/delete errors
          }
        }
      }
    }
  } catch (e) {
    logger.warn(`Error during media cleanup in /tmp: ${e.message}`);
  }

  const freedMb = (freedBytes / (1024 * 1024)).toFixed(2);
  logger.info(`🧹 Media cleanup complete: Removed ${removedCount} file(s) older than 7 days (${freedMb} MB freed).`);
  return { removedCount, freedBytes, freedMb };
}

/**
 * Starts automatic daily background cleanup job.
 */
function startAutoCleanupScheduler() {
  // Run initial cleanup check on startup
  cleanTmpMediaFiles();

  // Run automatically every 24 hours
  setInterval(() => {
    logger.info('⏰ Executing scheduled daily media folder cleanup...');
    cleanTmpMediaFiles();
  }, 24 * 60 * 60 * 1000);
}

module.exports = {
  cleanTmpMediaFiles,
  startAutoCleanupScheduler
};
