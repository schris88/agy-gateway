const fs = require('fs');
const logger = require('./src/logger');
const config = require('./src/config');
const { startWebServer } = require('./src/webServer');
const { startWhatsAppGateway } = require('./src/gateway');

async function main() {
  console.log(`
  =======================================================
   🚀 AGY WHATSAPP GATEWAY DAEMON
   Antigravity Agent 24/7 WhatsApp Service
  =======================================================
  `);

  logger.info(`AGY Binary Path: ${config.agyBinPath}`);
  logger.info(`Auth Storage Dir: ${config.authDir}`);
  logger.info(`Self Chat Enabled: ${config.whatsappAllowSelf}`);
  logger.info(`Allowed Numbers: ${config.whatsappAllowedNumbers.join(', ')}`);

  // Verify AGY binary
  if (!fs.existsSync(config.agyBinPath) && config.agyBinPath !== 'agy') {
    logger.warn(`AGY binary not found at ${config.agyBinPath}. Please ensure agy CLI is installed.`);
  }

  // Ensure Auth directory exists
  if (!fs.existsSync(config.authDir)) {
    fs.mkdirSync(config.authDir, { recursive: true });
  }

  // 1. Start Web Dashboard
  startWebServer();

  // 2. Start WhatsApp Gateway connection
  await startWhatsAppGateway();
}

// Global Unhandled Rejection / Exception Handlers to keep process alive 24/7
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception in Gateway Daemon');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason }, 'Unhandled Rejection in Gateway Daemon');
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down gateway gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down gateway gracefully...');
  process.exit(0);
});

main();
