require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OpenAI } = require('openai');

console.log("✅ GMAIL_CLIENT_ID loaded:", process.env.GMAIL_CLIENT_ID);
console.log("✅ REFRESH_TOKEN:", process.env.GMAIL_REFRESH_TOKEN ? '✔️' : '❌ MISSING');
console.log("✅ CLIENT_SECRET:", process.env.GMAIL_CLIENT_SECRET ? '✔️' : '❌ MISSING');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Tillåt Lovable (prod & preview) i CORS
app.use(cors({
  origin: [
    'https://lovable.dev',
    'https://id-preview--c425777f-df3c-4fdd-af29-76e7a96e2758.lovable.app'
  ]
}));
app.use(express.json());

// === Gmail-auth setup ===
const auth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth });

// === OpenAI setup ===
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === ENDPOINT: /emails ===
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
    console.error('❌ FEL i /emails:', err.message || err);
    res.status(500).json({ message: 'Fel vid hämtning av mail', error: err.message });
  }
});

// === ENDPOINT: /email/reply ===
app.post('/email/reply', async (req, res) => {
  console.log("🤖 /email/reply endpoint called");
  const { threadId, messageId, prompt } = req.body;

  if (!threadId || !prompt) {
    return res.status(400).json({ error: 'threadId och prompt krävs' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;
    console.log("✅ GPT-svar genererat");

    res.json({ reply });
  } catch (err) {
    console.error("❌ FEL i /email/reply:", err.message || err);
    res.status(500).json({ message: 'Fel vid generering av svar', error: err.message });
  }
});

// === STARTA SERVER ===
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
