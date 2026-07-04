# WhatsApp API Server

Node.js API for sending WhatsApp messages and verification OTP messages.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

If PowerShell blocks `npm start` on Windows, run:

```bash
node server.js
```

On first run, scan the QR code printed in the terminal:

WhatsApp > Linked devices > Link a device

You can also open this page and scan from the browser:

```bash
GET /api/whatsapp/qr
```

If you set `API_KEY`, open:

```bash
GET /api/whatsapp/qr?api_key=your-secret-key
```

## Send a Message

```js
await fetch('https://your-render-link.onrender.com/api/whatsapp/send-message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-secret-key'
  },
  body: JSON.stringify({
    numberphone: numberphone,
    message: String(message).trim()
  })
});
```

`numberphone` should include the country code, for example `96170123456`.

## Send an OTP

```js
await fetch('https://your-render-link.onrender.com/api/whatsapp/send-otp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-secret-key'
  },
  body: JSON.stringify({
    numberphone: numberphone,
    otp: '123456'
  })
});
```

## Status

```bash
GET /api/whatsapp/status
```

Returns whether WhatsApp is connected.

## Deploy on Render

Use these settings:

- Build Command: `npm install`
- Start Command: `npm start`
- Environment:
  - `API_KEY`: any secret value you choose
  - `PORT`: Render sets this automatically, so it can be omitted

Important: Render free instances can restart and lose local WhatsApp login files unless persistent disk is configured. If that happens, you will need to scan the QR code again.
