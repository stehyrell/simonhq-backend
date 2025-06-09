require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// Initiera OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initiera Gmail API
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);
oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

// Läs in mail-cache från fil
let emailCache = [];
const cachePath = './email-cache.json';
if (fs.existsSync(cachePath)) {
  emailCache = JSON.parse(fs.readFileSync(cachePath));
}

// 📨 Hämta de senaste 10 mailen
app.get('/api/email/latest', (req, res) => {
  const recent = emailCache
    .filter(email => email.to === 'simon@yran.se')
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
    .slice(0, 10);
  res.json(recent);
});

// 🤖 Generera svar
app.post('/api/email/reply', async (req, res) => {
  try {
    const instruction = req.body.instruction;
    const latest = emailCache
      .filter(e => e.to === 'simon@yran.se' && !e.isReplied)
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))[0];

    if (!latest) return res.status(404).json({ error: 'Inget obemött mail hittades.' });

    // 🧠 Skapa GPT-svar
    const prompt = `Du är Simon Tehyrell, affärsutvecklare för Storsjöyran. Du har fått följande mail:\n\nAvsändare: ${latest.from.name} <${latest.from.email}>\nÄmne: ${latest.subject}\n\nMailinnehåll:\n${latest.body}\n\nInstruktion: ${instruction}\n\nSkriv ett lämpligt, vänligt och professionellt svar.`;

    const chat = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    });

    const reply = chat.choices[0].message.content;

    console.log('🧪 Genererat svar:\n', reply);

    // ✅ Markera som besvarat
    latest.isReplied = true;

    // 📝 Logga i historik
    const historyPath = './history.json';
    const history = fs.existsSync(historyPath)
      ? JSON.parse(fs.readFileSync(historyPath))
      : [];

    history.push({
      id: uuidv4(),
      sentAt: new Date().toISOString(),
      to: latest.from.email,
      subject: latest.subject,
      instruction,
      reply,
    });

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

    res.json({ success: true, reply });
  } catch (err) {
    console.error('🚨 Fel vid autosvar:', err);
    res.status(500).json({ error: 'Failed to send reply', details: err.message });
  }
});

// 🏁 Starta server
app.listen(PORT, () => {
  console.log(`✅ Simon HQ Backend körs på port ${PORT}`);
});
