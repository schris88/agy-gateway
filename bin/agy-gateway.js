#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
AGY WhatsApp Gateway CLI

Usage:
  npx agy-gateway           Start the WhatsApp Gateway service
  agy-gateway               Start the WhatsApp Gateway service (if globally linked)

Options:
  --help, -h               Show this help message
  --version, -v            Show version
  --clean-auth             Clean existing session auth files before starting
  --port <number>          Override web dashboard port (default: 3000)
  --auth-dir <path>        Override auth credentials directory (default: ./auth_info_baileys)

Environment Variables (.env file supported):
  AGY_BIN_PATH             Path to agy binary (default: auto-detected)
  WHATSAPP_ALLOW_SELF      Allow processing self-chat messages (default: true)
  WHATSAPP_ALLOWED_NUMBERS Allowed phone numbers separated by comma, or * for all
  PORT                     Web server port (default: 3000)
  AUTH_DIR                 Directory for Baileys session auth
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkg = require('../package.json');
  console.log(`agy-gateway v${pkg.version}`);
  process.exit(0);
}

// Override environment variables if passed via CLI flags
const portIndex = args.indexOf('--port');
if (portIndex !== -1 && args[portIndex + 1]) {
  process.env.PORT = args[portIndex + 1];
}

const authIndex = args.indexOf('--auth-dir');
if (authIndex !== -1 && args[authIndex + 1]) {
  process.env.AUTH_DIR = args[authIndex + 1];
}

if (args.includes('--clean-auth')) {
  const authDir = path.resolve(process.env.AUTH_DIR || './auth_info_baileys');
  if (fs.existsSync(authDir)) {
    console.log(`🧹 Cleaning auth directory: ${authDir}`);
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}

require('../index.js');
