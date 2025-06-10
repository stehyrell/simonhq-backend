require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OpenAI } = require('openai');

// === LOGG ===
console.log("✅ GMAIL_CLIENT_ID loaded:", process.env.GMAIL_CLIENT_ID || '❌ MISSING');
console.log("✅ CLIENT_SECRET:", process.env.GMAIL_CLIENT_SECRET ? '✔️' : '❌ MISSING');
console.log("✅ REFRESH_TOKEN:", process.env.GMAIL_REFRESH_TOKEN ? '✔️' : '❌ MISSING');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// === Gmail OAuth2 Setup ===
const auth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

auth.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth });

// === OpenAI Setup (passiv i detta steg) ===
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// === EMAIL FETCH ENDPOINT ===
app.get('/emails', async (req, res) => {
  try {
    console.log("📩 /emails endpoint called");

    const { data } = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10,
      q: 'to:simon@yran.se'
    });

    const messages = data.messages || [];
    const result = [];

    for (const message of messages) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full'
      });

      const headers = msg.data.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const body = msg.data.snippet || '';

      result.push({
        id: message.id,
        threadId: msg.data.threadId,
        from: { name: from, email: from },
        to: 'simon@yran.se',
        subject,
        body,
        bodyType: 'text',
        receivedAt: new Date(Number(msg.data.internalDate)).toISOString(),
        isReplied: false
      });
    }

    res.json(result);
  } catch (err) {
    console.error('❌ FEL i /emails:', {
      message: err.message,
      code: err.code,
      stack: err.stack,
      response: err.response?.data || 'no response',
    });
    res.status(500).json({ message: 'Fel vid hämtning av mail', error: err.message });
  }
});

// === START SERVER ===
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
