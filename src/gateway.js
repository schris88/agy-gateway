const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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

function clearAuthSession() {
  if (fs.existsSync(config.authDir)) {
    logger.info(`Clearing auth directory ${config.authDir} for fresh pairing...`);
    fs.rmSync(config.authDir, { recursive: true, force: true });
    fs.mkdirSync(config.authDir, { recursive: true });
  }
}

async function startWhatsAppGateway() {
  logger.info(`Initializing Baileys WhatsApp connection (Auth Dir: ${config.authDir})...`);
  setConnectionStatus('CONNECTING');

  // Ensure Auth directory exists
  if (!fs.existsSync(config.authDir)) {
    fs.mkdirSync(config.authDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Using Baileys version ${version.join('.')} (isLatest: ${isLatest})`);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'), // Standard desktop browser tuple
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    generateHighQualityLinkPreview: true
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
      logger.warn(`Connection closed due to status ${statusCode}: ${lastDisconnect?.error?.message || 'unknown'}. Reconnecting: ${shouldReconnect}`);
      setConnectionStatus('DISCONNECTED');

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        logger.error('WhatsApp session logged out or invalid. Clearing auth directory for fresh QR code pairing...');
        clearAuthSession();
        setTimeout(startWhatsAppGateway, 3000);
      } else if (shouldReconnect) {
        setTimeout(startWhatsAppGateway, 5000);
      } else {
        setTimeout(startWhatsAppGateway, 5000);
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
      if (fromMe && !config.whatsappAllowSelf) {
        continue;
      }

      const senderJid = msg.key.remoteJid;

      // Filter allowed phone numbers
      if (!isJidAllowed(senderJid, fromMe)) {
        logger.info(`Ignoring message from non-whitelisted sender: ${senderJid}`);
        continue;
      }

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
        sendImageMessage: async (targetJid, imagePath, captionText) => {
          try {
            if (!fs.existsSync(imagePath)) {
              logger.warn(`Cannot send image: file does not exist at ${imagePath}`);
              return;
            }
            logger.info(`📤 Sending generated image file ${imagePath} to ${targetJid}`);
            const sent = await sock.sendMessage(targetJid, {
              image: fs.readFileSync(imagePath),
              caption: captionText ? captionText : undefined
            });
            if (sent?.key?.id) {
              gatewaySentMessageIds.add(sent.key.id);
            }
            return sent;
          } catch (err) {
            logger.error({ err }, `Failed to send WhatsApp image to ${targetJid}`);
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

      // Extract message text or process media with live progress notifications
      const content = await extractMessageContent(msg, senderJid, gatewayRef);
      if (!content || !content.text) continue;

      logger.info(`📩 Received message (${content.type}) from ${senderJid} (fromMe: ${fromMe}): "${content.text.slice(0, 70)}"`);

      // Pass to command router
      try {
        await handleIncomingMessage(senderJid, content.text, gatewayRef);
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

async function extractMessageContent(msg, senderJid, gatewayRef) {
  const message = msg.message;
  if (!message) return null;

  // 1. Text message
  if (message.conversation) {
    return { type: 'text', text: message.conversation };
  }
  if (message.extendedTextMessage && message.extendedTextMessage.text) {
    return { type: 'text', text: message.extendedTextMessage.text };
  }

  // 2. Image message
  if (message.imageMessage) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const filename = `whatsapp_img_${Date.now()}_${Math.floor(Math.random()*1000)}.jpg`;
      const filePath = path.join('/tmp', filename);
      fs.writeFileSync(filePath, buffer);

      const caption = message.imageMessage.caption ? ` Caption: "${message.imageMessage.caption}"` : '';
      const promptText = `[Received Image File saved at: ${filePath}]${caption} Please inspect and analyze this image to fulfill the request.`;

      logger.info(`Downloaded image to ${filePath} (${buffer.length} bytes)`);
      return { type: 'image', text: promptText, filePath };
    } catch (e) {
      logger.error({ e }, 'Failed to download image media message');
      if (message.imageMessage.caption) {
        return { type: 'text', text: message.imageMessage.caption };
      }
      return { type: 'text', text: '[User sent an image file]' };
    }
  }

  // 3. Audio / Voice message (PTT)
  if (message.audioMessage) {
    if (gatewayRef && gatewayRef.sendMessage) {
      await gatewayRef.sendMessage(senderJid, '🎙️ *Voice Message Received!* Downloading and transcribing audio...');
      await gatewayRef.sendTyping(senderJid);
    }

    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const oggPath = path.join('/tmp', `whatsapp_audio_${Date.now()}_${Math.floor(Math.random()*1000)}.ogg`);
      const wavPath = oggPath.replace('.ogg', '.wav');
      fs.writeFileSync(oggPath, buffer);

      // Convert OGG Opus to WAV using ffmpeg
      try {
        execSync(`ffmpeg -y -i "${oggPath}" -ar 16000 -ac 1 "${wavPath}" 2>/dev/null`);
      } catch (ffErr) {
        logger.warn('ffmpeg conversion failed, using ogg file');
      }

      const audioFileToUse = fs.existsSync(wavPath) ? wavPath : oggPath;

      // Try fast SpeechRecognition
      let transcriptionText = null;
      const transcribeScript = path.join(__dirname, 'transcribe.py');
      if (fs.existsSync(transcribeScript)) {
        try {
          transcriptionText = execSync(`python3 "${transcribeScript}" "${audioFileToUse}"`, { encoding: 'utf-8', timeout: 15000 }).trim();
        } catch (tErr) {
          logger.warn(`Voice transcription produced no output or timed out: ${tErr.message}`);
        }
      }

      let promptText = '';
      if (transcriptionText) {
        if (gatewayRef && gatewayRef.sendMessage) {
          await gatewayRef.sendMessage(senderJid, `🎙️ *Voice Message Transcribed:* "${transcriptionText}"`);
        }
        promptText = `[Voice Message Transcribed: "${transcriptionText}"] (Audio file: ${audioFileToUse}). Please process this user request.`;
      } else {
        if (gatewayRef && gatewayRef.sendMessage) {
          await gatewayRef.sendMessage(senderJid, `🎙️ *Audio Received!* Forwarding voice note to AGY for processing...`);
        }
        promptText = `[Received Voice Message Audio File saved at: ${audioFileToUse}]. Transcribe this audio file and fulfill the request.`;
      }

      logger.info(`Downloaded voice note to ${audioFileToUse} (${buffer.length} bytes)`);
      return { type: 'audio', text: promptText, filePath: audioFileToUse };
    } catch (e) {
      logger.error({ e }, 'Failed to download audio media message');
      return { type: 'text', text: '[User sent a voice message]' };
    }
  }

  // 4. Video message
  if (message.videoMessage) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const filePath = path.join('/tmp', `whatsapp_video_${Date.now()}_${Math.floor(Math.random()*1000)}.mp4`);
      fs.writeFileSync(filePath, buffer);
      const caption = message.videoMessage.caption ? ` Caption: "${message.videoMessage.caption}"` : '';
      return { type: 'video', text: `[Received Video File saved at: ${filePath}]${caption} Please inspect and analyze this video file.`, filePath };
    } catch (e) {
      if (message.videoMessage.caption) return { type: 'text', text: message.videoMessage.caption };
    }
  }

  // 5. Document message
  if (message.documentMessage) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const fileName = message.documentMessage.fileName || `doc_${Date.now()}`;
      const filePath = path.join('/tmp', fileName);
      fs.writeFileSync(filePath, buffer);
      return { type: 'document', text: `[Received Document File saved at: ${filePath}] Please inspect and process this file.`, filePath };
    } catch (e) {
      // fallback
    }
  }

  return null;
}

module.exports = {
  startWhatsAppGateway,
  clearAuthSession
};
