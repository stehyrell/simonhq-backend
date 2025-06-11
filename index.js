require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// === TEMP LOGGAR ===
console.log("\u2705 GMAIL_CLIENT_ID loaded:", process.env.GMAIL_CLIENT_ID);
console.log("\u2705 REFRESH_TOKEN:", process.env.GMAIL_REFRESH_TOKEN ? 'OK' : 'MISSING');
console.log("\u2705 CLIENT_SECRET:", process.env.GMAIL_CLIENT_SECRET ? 'OK' : 'MISSING');

// === Gmail Auth Setup ===
const auth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth });

// === OpenAI Setup ===
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// === Endpoint: Hämta senaste mail ===
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

// === Endpoint: Generera GPT-svar ===
app.post('/email/reply', async (req, res) => {
  const { threadId, prompt } = req.body;

  if (!threadId || !prompt) {
    return res.status(400).json({ error: "threadId och prompt krävs" });
  }

  console.log("\ud83d\udd27 /email/reply called with:", { threadId, prompt });

  try {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    const messages = thread.data.messages.map(msg => {
      const body = msg.payload.parts?.[0]?.body?.data
        ? Buffer.from(msg.payload.parts[0].body.data, 'base64').toString('utf8')
        : '';
      const from = msg.payload.headers.find(h => h.name === 'From')?.value || '';
      const subject = msg.payload.headers.find(h => h.name === 'Subject')?.value || '';
      return `Från: ${from}\nÄmne: ${subject}\n${body}`;
    });

    const chatPrompt = `Du är en assistent som svarar på mail.\n\nTidigare konversation:\n${messages.join('\n\n')}\n\nSkriv ett svar enligt följande instruktion:\n${prompt}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: chatPrompt }],
      temperature: 0.7
    });

    const reply = completion.choices[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error("\u274c Fel vid GPT-generering:", err);
    res.status(500).json({ message: 'Fel vid GPT-generering', error: err.message });
  }
});

// === Starta Server ===
app.listen(PORT, () => {
  console.log(`\u2705 Server listening on port ${PORT}`);
});
