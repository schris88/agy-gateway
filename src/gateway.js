const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
  areJidsSameUser,
  jidNormalizedUser
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
const { loadReminders } = require('./scheduler');

let sock = null;
const gatewaySentMessageIds = new Set();
const processedIncomingMessageIds = new Set();
const gatewayStartTime = Date.now();
const processedReactions = new Set();

// Seed processedReactions from feedback memory to prevent duplicate notifications across restarts
try {
  const { loadFeedback } = require('./feedback');
  const existingFb = loadFeedback();
  for (const fb of existingFb) {
    if (fb.msgId && fb.emoji) {
      processedReactions.add(`${fb.msgId}_${fb.emoji}`);
    }
  }
} catch (e) {
  // Ignore error if feedback not initialized
}

// Clean up old sent message IDs and reaction cache to save memory
setInterval(() => {
  if (gatewaySentMessageIds.size > 1000) {
    gatewaySentMessageIds.clear();
  }
  if (processedIncomingMessageIds.size > 5000) {
    processedIncomingMessageIds.clear();
  }
  if (processedReactions.size > 5000) {
    processedReactions.clear();
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
  if (sock) {
    try {
      sock.ev.removeAllListeners('connection.update');
      sock.ev.removeAllListeners('creds.update');
      sock.ev.removeAllListeners('messages.upsert');
      sock.ev.removeAllListeners('messages.update');
      sock.ws?.close();
      sock.end();
    } catch (e) {
      // Ignore socket cleanup errors
    }
    sock = null;
  }

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
      const isConflict = statusCode === DisconnectReason.connectionReplaced || statusCode === 440;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
      const shouldReconnect = !isLoggedOut;

      if (isConflict) {
        logger.warn(`⚠️ Connection closed due to status 440 (Conflict / Connection Replaced). Another process or instance is running with this session!`);
      } else {
        logger.warn(`Connection closed due to status ${statusCode}: ${lastDisconnect?.error?.message || 'unknown'}. Reconnecting: ${shouldReconnect}`);
      }
      setConnectionStatus('DISCONNECTED');

      if (isLoggedOut) {
        logger.error('WhatsApp session logged out or invalid. Clearing auth directory for fresh QR code pairing...');
        clearAuthSession();
        setTimeout(startWhatsAppGateway, 3000);
      } else if (isConflict) {
        // Back off 10s on conflict to prevent rapid reconnect loop fighting with concurrent instance
        setTimeout(startWhatsAppGateway, 10000);
      } else if (shouldReconnect) {
        setTimeout(startWhatsAppGateway, 5000);
      } else {
        setTimeout(startWhatsAppGateway, 5000);
      }
    } else if (connection === 'open') {
      const me = sock.user;
      logger.info(`✅ WhatsApp Connection Established! Logged in as: ${me?.name || me?.id}`);
      setConnectionStatus('CONNECTED', me);

      // Create gateway reference and load active reminders
      const gatewayRef = createGatewayRef();
      loadReminders(gatewayRef);
    }
  });

  function createGatewayRef() {
    return {
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
      sendDocumentMessage: async (targetJid, filePath, captionText) => {
        try {
          if (!fs.existsSync(filePath)) {
            logger.warn(`Cannot send document: file does not exist at ${filePath}`);
            return;
          }
          const filename = path.basename(filePath);
          logger.info(`📄 Sending document file ${filePath} to ${targetJid}`);
          const sent = await sock.sendMessage(targetJid, {
            document: fs.readFileSync(filePath),
            fileName: filename,
            mimetype: 'application/octet-stream',
            caption: captionText ? captionText : undefined
          });
          if (sent?.key?.id) {
            gatewaySentMessageIds.add(sent.key.id);
          }
          return sent;
        } catch (err) {
          logger.error({ err }, `Failed to send WhatsApp document to ${targetJid}`);
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
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const messageId = msg.key.id;

      // Ignore messages sent by this gateway instance to prevent loops
      if (gatewaySentMessageIds.has(messageId)) {
        continue;
      }

      // Ignore duplicate incoming message IDs (prevents double executions for self-chats/re-transmissions)
      if (processedIncomingMessageIds.has(messageId)) {
        logger.info(`Ignoring duplicate incoming message ID: ${messageId}`);
        continue;
      }
      processedIncomingMessageIds.add(messageId);

      const fromMe = !!msg.key.fromMe;
      const senderJid = msg.key.remoteJid;

      // Merge sock.user and state.creds.me because sock.user sometimes lacks the .lid property
      const meUser = { ...(state?.creds?.me || {}), ...(sock?.user || {}) };

      // Filter allowed JIDs (self-chat only by default, groups blocked by default)
      if (!isJidAllowed(senderJid, fromMe, meUser)) {
        logger.info(`Ignoring message from non-whitelisted sender/chat: ${senderJid} (fromMe: ${fromMe})`);
        continue;
      }

      const gatewayRef = createGatewayRef();

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

  // Listen for WhatsApp message reactions (emojis like 👍, 👎, ❤️, 🔥)
  sock.ev.on('messages.reaction', async (reactions) => {
    for (const reaction of reactions) {
      const senderJid = reaction.key.remoteJid;
      const fromMe = !!reaction.key.fromMe;
      const meUser = { ...(state?.creds?.me || {}), ...(sock?.user || {}) };

      if (!isJidAllowed(senderJid, fromMe, meUser)) continue;

      const emoji = reaction.reaction?.text;
      const targetMsgId = reaction.key.id;
      const timestamp = reaction.reaction?.senderTimestampMs || reaction.timestamp;

      // Ignore reactions created before gateway process started (historic sync)
      if (timestamp && Number(timestamp) < gatewayStartTime - 5000) {
        logger.info(`Ignoring historic reaction ${emoji} on msg ${targetMsgId}`);
        continue;
      }

      const rxKey = `${targetMsgId}_${emoji}`;
      if (processedReactions.has(rxKey)) {
        continue;
      }
      processedReactions.add(rxKey);

      if (emoji) {
        logger.info(`👍 Received reaction ${emoji} from ${senderJid} on message ${targetMsgId}`);
        const gatewayRef = createGatewayRef();
        const { handleMessageReaction } = require('./commandHandler');
        await handleMessageReaction(senderJid, targetMsgId, emoji, gatewayRef);
      }
    }
  });
}

function isJidAllowed(jid, fromMe, meUser) {
  if (!jid) return false;

  // 1. Group Chat Filter: Block groups by default unless WHATSAPP_ALLOW_GROUPS=true
  if (jid.endsWith('@g.us')) {
    if (!config.whatsappAllowGroups) {
      return false;
    }
    const groupId = jid.split('@')[0];
    if (config.whatsappAllowedNumbers.includes('*')) return true;
    return config.whatsappAllowedNumbers.some(num => groupId.includes(num));
  }

  // 2. Official Baileys JID normalization and user matching
  const normalizedTargetJid = jidNormalizedUser(jid);
  const targetNum = normalizedTargetJid.split('@')[0].replace(/[^0-9]/g, '');

  const myNum = meUser?.id ? jidNormalizedUser(meUser.id).split('@')[0].replace(/[^0-9]/g, '') : '';
  const myLid = meUser?.lid ? jidNormalizedUser(meUser.lid).split('@')[0].replace(/[^0-9]/g, '') : '';

  // 3. Self-Chat Detection:
  // Use official Baileys helper areJidsSameUser to check if target matches authenticated user JID or LID
  const isSameUser = (meUser?.id && areJidsSameUser(jid, meUser.id)) ||
                     (meUser?.lid && areJidsSameUser(jid, meUser.lid)) ||
                     (myNum && targetNum === myNum) ||
                     (myLid && targetNum === myLid);

  const isSelfChat = fromMe && isSameUser;

  if (isSelfChat) {
    return config.whatsappAllowSelf;
  }

  if (fromMe) {
    return false; // Prevent gateway from triggering on own messages in other chats
  }

  // 4. External Chat (incoming from other contact like Mom, or outgoing in Mom's chat window)
  if (config.whatsappAllowedNumbers.includes('*')) {
    return true;
  }

  if (!config.whatsappAllowedNumbers.length) {
    return false;
  }

  return config.whatsappAllowedNumbers.some(num => targetNum.endsWith(num) || num.endsWith(targetNum));
}

function extractQuotedContext(message) {
  if (!message) return '';
  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.audioMessage?.contextInfo ||
    message.documentMessage?.contextInfo;

  if (!contextInfo?.quotedMessage) return '';

  const q = contextInfo.quotedMessage;
  let quotedText = '';
  if (q.conversation) {
    quotedText = q.conversation;
  } else if (q.extendedTextMessage?.text) {
    quotedText = q.extendedTextMessage.text;
  } else if (q.imageMessage?.caption) {
    quotedText = `[Image: "${q.imageMessage.caption}"]`;
  } else if (q.videoMessage?.caption) {
    quotedText = `[Video: "${q.videoMessage.caption}"]`;
  } else if (q.documentMessage?.fileName || q.documentMessage?.caption) {
    quotedText = `[Document: "${q.documentMessage.fileName || q.documentMessage.caption}"]`;
  } else if (q.audioMessage) {
    quotedText = '[Voice Message]';
  }

  if (quotedText) {
    return `[Replying to quoted message: "${quotedText}"]\n\n`;
  }
  return '';
}

async function extractMessageContent(msg, senderJid, gatewayRef) {
  const message = msg.message;
  if (!message) return null;

  const quotedPrefix = extractQuotedContext(message);

  // 1. Text message
  if (message.conversation) {
    return { type: 'text', text: quotedPrefix + message.conversation };
  }
  if (message.extendedTextMessage && message.extendedTextMessage.text) {
    return { type: 'text', text: quotedPrefix + message.extendedTextMessage.text };
  }

  // 2. Image message
  if (message.imageMessage) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const filename = `whatsapp_img_${Date.now()}_${Math.floor(Math.random()*1000)}.jpg`;
      const filePath = path.join('/tmp', filename);
      fs.writeFileSync(filePath, buffer);

      const caption = message.imageMessage.caption ? ` Caption: "${message.imageMessage.caption}"` : '';
      const promptText = `[Received Image File saved at: ${filePath}]${caption} Please inspect and analyze this image to fulfill the request. If the user asks to edit, modify, transform, or generate an image based on this photo, call the generate_image tool with ImagePaths set to ["${filePath}"].`;

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
    const durationSec = message.audioMessage.seconds || 0;
    const durationStr = durationSec ? ` (${durationSec}s)` : '';
    const transEstSec = Math.max(3, Math.min(15, Math.ceil((durationSec || 10) * 0.5)));

    // Periodically refresh typing indicator in WhatsApp during audio download & transcription
    const typingInterval = setInterval(() => {
      if (gatewayRef && gatewayRef.sendTyping) {
        gatewayRef.sendTyping(senderJid).catch(() => {});
      }
    }, 5000);

    if (gatewayRef && gatewayRef.sendMessage) {
      await gatewayRef.sendMessage(
        senderJid,
        `🎙️ *Voice Message Received!*${durationStr}\n⏳ *Step 1/2:* Downloading & transcribing audio (~${transEstSec}s est.)...`
      );
      await gatewayRef.sendTyping(senderJid);
    }

    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const oggPath = path.join('/tmp', `whatsapp_audio_${Date.now()}_${Math.floor(Math.random()*1000)}.ogg`);
      const flacPath = oggPath.replace('.ogg', '.flac');
      const wavPath = oggPath.replace('.ogg', '.wav');
      fs.writeFileSync(oggPath, buffer);

      // Convert OGG Opus to 16kHz mono FLAC (and WAV fallback) using ffmpeg
      try {
        execSync(`ffmpeg -y -i "${oggPath}" -ar 16000 -ac 1 "${flacPath}" 2>/dev/null`);
      } catch (ffErr) {
        try {
          execSync(`ffmpeg -y -i "${oggPath}" -ar 16000 -ac 1 "${wavPath}" 2>/dev/null`);
        } catch (ffWavErr) {
          logger.warn('ffmpeg FLAC and WAV conversion failed, using ogg file');
        }
      }

      const audioFileToUse = fs.existsSync(flacPath) ? flacPath : (fs.existsSync(wavPath) ? wavPath : oggPath);

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

      clearInterval(typingInterval);

      let promptText = '';
      if (transcriptionText) {
        if (gatewayRef && gatewayRef.sendMessage) {
          await gatewayRef.sendMessage(
            senderJid,
            `🎙️ *Voice Message Transcribed:*\n💬 _"${transcriptionText}"_\n\n🤖 *Step 2/2:* Processing request with AGY...`
          );
        }
        promptText = `[Voice Message Transcribed: "${transcriptionText}"] (Audio: ${audioFileToUse}). Start response with: "🗣️ *Understood:* \\"${transcriptionText}\\"". Fulfill the request.`;
      } else {
        if (gatewayRef && gatewayRef.sendMessage) {
          await gatewayRef.sendMessage(
            senderJid,
            `🎙️ *Audio Note Received!*\n🤖 *Step 2/2:* Forwarding voice note to AGY for multi-modal processing...`
          );
        }
        promptText = `[Received Voice Audio File: ${audioFileToUse}]. Transcribe audio and start response with: "🗣️ *Understood:* \\"<transcription>\\"". Fulfill the request.`;
      }

      // Cleanup unused temporary audio formats to save disk space
      try {
        if (fs.existsSync(oggPath) && audioFileToUse !== oggPath) fs.unlinkSync(oggPath);
        if (fs.existsSync(wavPath) && audioFileToUse !== wavPath) fs.unlinkSync(wavPath);
      } catch (e) {}

      logger.info(`Downloaded voice note to ${audioFileToUse} (${buffer.length} bytes)`);
      return { type: 'audio', text: promptText, filePath: audioFileToUse };
    } catch (e) {
      clearInterval(typingInterval);
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
