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

// === Gmail Auth Setup ===
const auth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth });

// === OpenAI Setup ===
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === Endpoint: /emails (Live fetch) ===
app.get('/emails', async (req, res) => {
  try {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 20,
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
    console.error('❌ /emails error:', err);
    res.status(500).json({ message: 'Fel vid hämtning av mail', error: err.message });
  }
});

// === Endpoint: /emails/latest (cache fallback) ===
app.get('/emails/latest', async (req, res) => {
  res.redirect('/emails'); // Använder live-data tills caching implementeras
});

// === Endpoint: /email/thread/:id ===
app.get('/email/thread/:id', async (req, res) => {
  const threadId = req.params.id;
  try {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    const messages = thread.data.messages.map(msg => {
      const headers = msg.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const body = msg.payload.parts?.[0]?.body?.data
        ? Buffer.from(msg.payload.parts[0].body.data, 'base64').toString('utf8')
        : '';

      return {
        id: msg.id,
        from,
        subject,
        body
      };
    });

    res.json({ threadId, messages });
  } catch (err) {
    console.error('❌ /email/thread error:', err);
    res.status(500).json({ message: 'Kunde inte hämta tråd', error: err.message });
  }
});

// === Endpoint: /email/reply ===
app.post('/email/reply', async (req, res) => {
  let { threadId, prompt, systemPrompt } = req.body;

  if (!prompt && req.body.instruction) {
    prompt = req.body.instruction;
  }

  if (!threadId || !prompt) {
    return res.status(400).json({ error: 'threadId och prompt krävs' });
  }

  try {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    const messages = thread.data.messages.map(msg => {
      const headers = msg.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const body = msg.payload.parts?.[0]?.body?.data
        ? Buffer.from(msg.payload.parts[0].body.data, 'base64').toString('utf8')
        : '';
      return `Från: ${from}\nÄmne: ${subject}\n${body}`;
    });

    const fullPrompt = `Tidigare mailtråd:\n${messages.join('\n\n')}\n\nInstruktion:\n${prompt}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt || 'Du är en assistent som svarar på mail.' },
        { role: 'user', content: fullPrompt }
      ],
      temperature: 0.7
    });

    const reply = completion.choices[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error('❌ GPT-generering error:', err);
    res.status(500).json({ message: 'Fel vid GPT-generering', error: err.message });
  }
});

// === Endpoint: /email/send-reply ===
app.post('/email/send-reply', async (req, res) => {
  const { to, subject, body } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'to, subject och body krävs' });
  }

  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    body
  ].join('\n');

  try {
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: Buffer.from(rawMessage)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
      }
    });

    res.json({ message: 'Svar skickat' });
  } catch (err) {
    console.error('❌ Fel vid utskick:', err);
    res.status(500).json({ message: 'Fel vid utskick', error: err.message });
  }
});

// === Endpoint: /ai/yran/context ===
app.get('/ai/yran/context', (req, res) => {
  const contextPath = path.join(__dirname, 'yran_brain.json');
  fs.readFile(contextPath, 'utf8', (err, data) => {
    if (err) {
      console.error("❌ Kunde inte läsa yran_brain.json:", err);
      return res.status(500).json({ error: 'Kunde inte läsa Yran Brain' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  });
});

// === Server start ===
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
