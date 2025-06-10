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

app.use(cors());
app.use(express.json());

// === Gmail auth ===
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

// === /emails – Hämta mail till simon@yran.se ===
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
    console.error('❌ Fel vid hämtning av mail:', err);
    res.status(500).json({ message: 'Fel vid hämtning av mail' });
  }
});

// === /email/reply – Skapa GPT-svar ===
app.post('/email/reply', async (req, res) => {
  const { instruction, thread } = req.body;

  if (!instruction || !thread) {
    return res.status(400).json({ message: 'Missing instruction or thread' });
  }

  try {
    const messages = thread.messages.map(msg => ({
      role: 'user',
      content: `Från: ${msg.from}\nÄmne: ${msg.subject}\n\n${msg.body}`
    }));

    const chat = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Du är en vänlig men strategiskt smart mailassistent. Skriv kort, tydligt och med ton anpassad till Simons stil.' },
        ...messages,
        { role: 'user', content: instruction }
      ]
    });

    res.json({ reply: chat.choices[0].message.content });
  } catch (err) {
    console.error('❌ GPT-svar kunde inte genereras:', err);
    res.status(500).json({ message: 'Fel vid GPT-svar', error: err.message });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
