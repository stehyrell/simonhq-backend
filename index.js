require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OpenAI } = require('openai');

// === TEMP DEBUG ===
console.log("\u2705 GMAIL_CLIENT_ID loaded:", process.env.GMAIL_CLIENT_ID);
console.log("\u2705 REFRESH_TOKEN:", process.env.GMAIL_REFRESH_TOKEN ? '✔️' : '❌ MISSING');
console.log("\u2705 CLIENT_SECRET:", process.env.GMAIL_CLIENT_SECRET ? '✔️' : '❌ MISSING');

const app = express();
const PORT = process.env.PORT || 3000;

// === CORS ===
app.use(cors({
  origin: ['https://lovable.dev', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// === Gmail auth setup ===
const auth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
auth.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});
const gmail = google.gmail({ version: 'v1', auth });

// === OpenAI setup ===
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// === GET /emails ===
app.get('/emails', async (req, res) => {
  try {
    console.log("\ud83d\udce9 /emails endpoint called");
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
    console.error('\u274c Fel vid hämtning av mail:', err);
    res.status(500).json({ message: 'Fel vid hämtning av mail', error: err.message });
  }
});

// === POST /email/reply ===
app.post('/email/reply', async (req, res) => {
  try {
    const { threadId, messageId, prompt } = req.body;
    console.log("\u2705 /email/reply called with:", req.body);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Du är en professionell assistent. Formulera ett kort, vänligt och tydligt svar på mailet.' },
        { role: 'user', content: prompt }
      ]
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error("\u274c Fel i /email/reply:", error);
    res.status(500).json({ message: 'Fel vid svarsgenerering', error: error.message });
  }
});

// === START SERVER ===
app.listen(PORT, () => {
  console.log(`\u2705 Server listening on port ${PORT}`);
});
