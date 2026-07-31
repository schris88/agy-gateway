const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const logger = require('./logger');
const config = require('./config');
const { setQrCode, setConnectionStatus } = require('./webServer');
const { handleIncomingMessage } = require('./commandHandler');

let sock = null;
const gatewaySentMessageIds = new Set();

// Clean up old sent message IDs to save memory
setInterval(() => {
  if (gatewaySentMessageIds.size > 1000) {
    gatewaySentMessageIds.clear();
  }
}, 3600000);

async function startWhatsAppGateway() {
  logger.info(`Initializing Baileys WhatsApp connection (Auth Dir: ${config.authDir})...`);
  setConnectionStatus('CONNECTING');

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['AGY Antigravity Gateway', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('📱 New WhatsApp QR Code generated!');
      console.log('\n======================================================');
      console.log('📱 SCAN THIS QR CODE IN WHATSAPP (Linked Devices):');
      console.log('======================================================\n');
      qrcodeTerminal.generate(qr, { small: true });
      console.log('\n======================================================');
      console.log(`🌐 Or view QR code in browser at: http://localhost:${config.port}`);
      console.log('======================================================\n');
      setQrCode(qr);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn(`Connection closed due to: ${lastDisconnect?.error?.message || 'unknown'}. Reconnecting: ${shouldReconnect}`);
      setConnectionStatus('DISCONNECTED');

      if (shouldReconnect) {
        setTimeout(startWhatsAppGateway, 5000);
      } else {
        logger.error('WhatsApp session logged out. Please clear auth_info_baileys and re-scan QR code.');
      }
    } else if (connection === 'open') {
      const me = sock.user;
      logger.info(`✅ WhatsApp Connection Established! Logged in as: ${me?.name || me?.id}`);
      setConnectionStatus('CONNECTED', me);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const messageId = msg.key.id;

      // Ignore messages sent by this gateway instance to prevent loops
      if (gatewaySentMessageIds.has(messageId)) {
        continue;
      }

      const fromMe = !!msg.key.fromMe;

      // Handle Self-Chat:
      // If message is fromMe, check if WHATSAPP_ALLOW_SELF is enabled
      if (fromMe && !config.whatsappAllowSelf) {
        continue;
      }

      const senderJid = msg.key.remoteJid;

      // Filter allowed phone numbers
      if (!isJidAllowed(senderJid, fromMe)) {
        logger.info(`Ignoring message from non-whitelisted sender: ${senderJid}`);
        continue;
      }

      // Extract message text
      const text = extractText(msg.message);
      if (!text) continue;

      logger.info(`📩 Received message from ${senderJid} (fromMe: ${fromMe}): "${text.slice(0, 50)}"`);

      // Construct gateway reference for response sending
      const gatewayRef = {
        sendMessage: async (targetJid, textContent) => {
          try {
            const sent = await sock.sendMessage(targetJid, { text: textContent });
            if (sent?.key?.id) {
              gatewaySentMessageIds.add(sent.key.id);
            }
            return sent;
          } catch (err) {
            logger.error({ err }, `Failed to send WhatsApp message to ${targetJid}`);
          }
        },
        sendTyping: async (targetJid, isComposing = true) => {
          try {
            await sock.sendPresenceUpdate(isComposing ? 'composing' : 'paused', targetJid);
          } catch (e) {
            // Ignore presence errors
          }
        }
      };

      // Pass to command router
      try {
        await handleIncomingMessage(senderJid, text, gatewayRef);
      } catch (err) {
        logger.error({ err }, `Error handling message from ${senderJid}`);
      }
    }
  });
}

function isJidAllowed(jid, fromMe) {
  if (fromMe && config.whatsappAllowSelf) return true;
  if (config.whatsappAllowedNumbers.includes('*')) return true;

  const cleanNum = jid.split('@')[0].replace(/[^0-9]/g, '');
  return config.whatsappAllowedNumbers.some(num => cleanNum.endsWith(num) || num.endsWith(cleanNum));
}

function extractText(message) {
  if (message.conversation) {
    return message.conversation;
  }
  if (message.extendedTextMessage && message.extendedTextMessage.text) {
    return message.extendedTextMessage.text;
  }
  if (message.imageMessage && message.imageMessage.caption) {
    return message.imageMessage.caption;
  }
  if (message.videoMessage && message.videoMessage.caption) {
    return message.videoMessage.caption;
  }
  return null;
}

module.exports = {
  startWhatsAppGateway
};
