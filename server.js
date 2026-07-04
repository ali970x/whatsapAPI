require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const qrImage = require('qrcode');
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || 'auth_info_baileys';

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let sock = null;
let isReady = false;
let lastQr = null;
let lastQrAt = null;
let reconnectTimer = null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return next();
  }

  const headerKey = req.get('x-api-key');
  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const queryKey = req.query.api_key || req.query.key;
  if (headerKey === API_KEY || bearer === API_KEY || queryKey === API_KEY) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Unauthorized',
  });
}

function normalizePhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  return `${digits}@s.whatsapp.net`;
}

async function sendWhatsappText(numberphone, message) {
  const text = String(message || '').trim();
  const jid = normalizePhone(numberphone);

  if (!jid) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'numberphone is required',
      },
    };
  }

  if (!text) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'message is required',
      },
    };
  }

  if (!sock || !isReady) {
    return {
      status: 503,
      body: {
        success: false,
        message: 'WhatsApp is not connected yet. Scan the QR code first.',
      },
    };
  }

  const result = await sock.sendMessage(jid, { text });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Message sent successfully',
      data: {
        to: String(numberphone),
        id: result?.key?.id || null,
      },
    },
  };
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWhatsapp().catch((error) => {
      logger.error({ error }, 'Failed to reconnect WhatsApp');
      scheduleReconnect();
    });
  }, 3000);
}

async function connectWhatsapp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: ['WhatsApp API Server', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQr = qr;
      lastQrAt = new Date().toISOString();
      isReady = false;
      console.log('\nScan this QR code with WhatsApp > Linked devices:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nWaiting for WhatsApp login...\n');
    }

    if (connection === 'open') {
      isReady = true;
      lastQr = null;
      logger.info('WhatsApp connected');
    }

    if (connection === 'close') {
      isReady = false;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(
        { statusCode, shouldReconnect },
        'WhatsApp connection closed'
      );

      if (shouldReconnect) {
        scheduleReconnect();
      } else {
        logger.error(
          `WhatsApp logged out. Delete ${AUTH_DIR} and restart to scan a new QR.`
        );
      }
    }
  });
}

app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'WhatsApp API Server',
    whatsappReady: isReady,
    sendMessageEndpoint: '/api/whatsapp/send-message',
  });
});

app.get('/api/whatsapp/status', requireApiKey, (req, res) => {
  res.json({
    success: true,
    whatsappReady: isReady,
    needsQrScan: !isReady,
    qrEndpoint: lastQr ? '/api/whatsapp/qr' : null,
    lastQrAt,
  });
});

app.get('/api/whatsapp/qr', requireApiKey, async (req, res) => {
  if (isReady) {
    return res.type('html').send(`
      <!doctype html>
      <html>
        <head><title>WhatsApp Connected</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
          <h1>WhatsApp is connected</h1>
        </body>
      </html>
    `);
  }

  if (!lastQr) {
    return res.status(404).json({
      success: false,
      message: 'QR code is not ready yet. Refresh in a few seconds.',
    });
  }

  const dataUrl = await qrImage.toDataURL(lastQr, {
    margin: 2,
    width: 320,
  });

  return res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <title>WhatsApp QR</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 32px;">
        <h1>Scan WhatsApp QR</h1>
        <p>Open WhatsApp > Linked devices > Link a device</p>
        <img src="${dataUrl}" alt="WhatsApp QR code" width="320" height="320" />
        <p>Generated at ${lastQrAt || ''}</p>
      </body>
    </html>
  `);
});

app.post('/api/whatsapp/send-message', requireApiKey, async (req, res) => {
  try {
    const { numberphone, message } = req.body || {};
    const result = await sendWhatsappText(numberphone, message);

    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error({ error }, 'Failed to send WhatsApp message');

    return res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message,
    });
  }
});

app.post('/api/whatsapp/send-otp', requireApiKey, async (req, res) => {
  try {
    const { numberphone, otp } = req.body || {};
    const code = String(otp || '').trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'otp is required',
      });
    }

    const result = await sendWhatsappText(
      numberphone,
      `Your verification code is: ${code}`
    );

    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error({ error }, 'Failed to send WhatsApp OTP');

    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: error.message,
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

connectWhatsapp().catch((error) => {
  logger.error({ error }, 'Failed to start WhatsApp connection');
});
