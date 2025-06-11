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
console.log("✅ GMAIL_CLIENT_ID loaded:", process.env.GMAIL_CLIENT_ID);
console.log("✅ REFRESH_TOKEN:", process.env.GMAIL_REFRESH_TOKEN ? 'OK' : 'MISSING');
console.log("✅ CLIENT_SECRET:", process.env.GMAIL_CLIENT_SECRET ? 'OK' : 'MISSING');

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

// === Endpoint: /emails ===
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
    res.status(500).json({ message: 'Fel vid hämtning av mail', error: err.message });
  }
});

// === DUPLICERAD ENDPOINT: /emails/latest ===
app.get('/emails/latest', async (req, res) => {
  console.log("📩 /emails/latest endpoint called");
  // Återanvänd exakt samma logik som /emails
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
});

// === Endpoint: /email/reply ===
app.post('/email/reply', async (req, res) => {
  let { threadId, prompt, systemPrompt } = req.body;

  if (!prompt && req.body.instruction) {
    console.warn("⚠️ Frontend skickade 'instruction' istället för 'prompt' – mappat om automatiskt.");
    prompt = req.body.instruction;
  }

  if (!threadId || !prompt) {
    console.error("❌ Saknar threadId eller prompt i request:", req.body);
    return res.status(400).json({ error: "threadId och prompt krävs" });
  }

  console.log("🧠 /email/reply called med:", {
    threadId,
    prompt,
    systemPrompt: systemPrompt ? '✅ provided' : '❌ missing'
  });

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
      messages: [
        { role: 'system', content: systemPrompt || 'Du är en assistent som svarar på mail.' },
        { role: 'user', content: chatPrompt }
      ],
      temperature: 0.7
    });

    const reply = completion.choices[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error("❌ Fel vid GPT-generering:", err);
    res.status(500).json({ message: 'Fel vid GPT-generering', error: err.message });
  }
});

// === NY ENDPOINT: /email/send-reply ===
app.post('/email/send-reply', async (req, res) => {
  const { to, subject, body } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ error: "to, subject och body krävs" });
  }

  try {
    const raw = [
      `To: ${to}`,
      'Subject: ' + subject,
      'Content-Type: text/html; charset=UTF-8',
      '',
      body
    ].join('\n');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: Buffer.from(raw).toString('base64url')
      }
    });

    res.json({ status: '✅ Mail skickat' });
  } catch (err) {
    console.error("❌ Fel vid mailutskick:", err);
    res.status(500).json({ error: 'Fel vid utskick', message: err.message });
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

// === Starta Server ===
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
