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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const SENT_FILE = './sentEmails.json';

// Skapa historikfil om den inte finns
if (!fs.existsSync(SENT_FILE)) fs.writeFileSync(SENT_FILE, '[]');

// ✅ Hämta senaste mail – nu som array + HTML fallback
app.get('/api/email/latest', async (req, res) => {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const inbox = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 1
    });

    const message = inbox.data.messages?.[0];
    if (!message) return res.json([]);

    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: message.id
    });

    const headers = detail.data.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const fromHeader = headers.find(h => h.name === 'From')?.value || '';
    const match = fromHeader.match(/(.*) <(.*)>/);
    const fromName = match ? match[1].trim() : fromHeader;
    const fromEmail = match ? match[2].trim() : fromHeader;

    const bodyPart = detail.data.payload.parts?.find(p => p.mimeType === 'text/plain') ||
                     detail.data.payload.parts?.find(p => p.mimeType === 'text/html') ||
                     detail.data.payload;

    const body = Buffer.from(bodyPart?.body?.data || '', 'base64').toString('utf-8');

    const sentHistory = JSON.parse(fs.readFileSync(SENT_FILE));
    const isReplied = sentHistory.some(e => e.gmailId === message.id);

    res.json([{
      id: uuidv4(),
      gmailId: message.id,
      from: { name: fromName, email: fromEmail },
      subject,
      body,
      receivedAt: new Date(Number(detail.data.internalDate)).toISOString(),
      isReplied
    }]);
  } catch (err) {
    console.error('🔴 Error fetching email:', err);
    res.status(500).json({ error: 'Failed to fetch latest email' });
  }
});

// ✉️ Skicka svar + spara i historik
app.post('/api/email/reply', async (req, res) => {
  const { to, subject, body, gmailId } = req.body;
  if (process.env.SILENT_MODE === 'true') return res.json({ silent: true });

  try {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ];
    const message = Buffer.from(messageParts.join('\n')).toString('base64');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: message }
    });

    const logEntry = {
      id: uuidv4(),
      gmailId,
      to,
      subject,
      body,
      sentAt: new Date().toISOString()
    };
    const existing = JSON.parse(fs.readFileSync(SENT_FILE));
    existing.push(logEntry);
    fs.writeFileSync(SENT_FILE, JSON.stringify(existing, null, 2));

    res.json({ success: true });
  } catch (err) {
    console.error('🔴 Error sending email:', err);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// 🧠 Skapa reply-mail med GPT baserat på instruktion
app.post('/api/email/draft', async (req, res) => {
  const { subject, body, instruction } = req.body;
  try {
    const prompt = `Svara på följande mail på svenska utifrån instruktionen: "${instruction}".\n\nÄmne: ${subject}\n\nInnehåll:\n${body}`;
    const reply = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }]
    });
    res.json({ reply: reply.choices[0].message.content.trim() });
  } catch (err) {
    console.error('🔴 Error drafting reply:', err);
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

// 🟢 Server igång
app.listen(PORT, () => {
  console.log(`✅ Simon HQ backend live på port ${PORT}`);
});
