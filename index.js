
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

// === Gmail & OpenAI Setup ===
const auth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === /emails ===
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
    res.status(500).json({ message: 'Fel vid hämtning av mail', error: err.message });
  }
});

// === /emails/latest ===
app.get('/emails/latest', async (req, res) => {
  res.redirect('/emails');
});

// === /email/thread/:id ===
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
    res.status(500).json({ message: 'Kunde inte hämta tråd', error: err.message });
  }
});

// === /email/reply ===
app.post('/email/reply', async (req, res) => {
  let { threadId, prompt, systemPrompt } = req.body;

  if (!prompt && req.body.instruction) {
    prompt = req.body.instruction;
  }

  if (!threadId || !prompt) {
    return res.status(400).json({ error: 'threadId och prompt krävs' });
  }

  try {
    let messages = [];

    if (threadId === 'yran-brain-chat') {
      messages = ["(Ingen tidigare konversation – använd systemPrompt och fråga som grund)"];
    } else {
      const thread = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full'
      });

      messages = thread.data.messages.map(msg => {
        const headers = msg.payload.headers;
        const from = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';

        let body = '';

        const parts = msg.payload.parts || [];
        const plain = parts.find(p => p.mimeType === 'text/plain');
        const html = parts.find(p => p.mimeType === 'text/html');
        const rawBody = plain?.body?.data || html?.body?.data || msg.payload.body?.data;

        if (rawBody) {
          body = Buffer.from(rawBody, 'base64').toString('utf8');
        }

        return `Från: ${from}
Ämne: ${subject}
${body}`;
      }).filter(Boolean);
    }

    const chatPrompt = `Tidigare mailtråd:
${messages.join('

')}

Instruktion:
${prompt}`;

    fs.appendFileSync('logs/promptlog.txt', `

====
${new Date().toISOString()}
${chatPrompt}`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt || 'Du är en assistent som svarar på mail.' },
        { role: 'user', content: chatPrompt }
      ],
      temperature: 0.7
    });

    const reply = completion.choices[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ message: 'Fel vid GPT-generering', error: err.message });
  }
});

// === /email/send-reply ===
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
  ].join('
');

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
    res.status(500).json({ message: 'Fel vid utskick', error: err.message });
  }
});

// === /ai/yran/context ===
app.get('/ai/yran/context', (req, res) => {
  const contextPath = path.join(__dirname, 'yran_brain.json');
  fs.readFile(contextPath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Kunde inte läsa Yran Brain' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  });
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`✅ Servern körs på port ${PORT}`);
});