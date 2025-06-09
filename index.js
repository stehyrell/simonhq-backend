require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const OpenAI = require('openai');
const fetchLatestEmails = require('./fetchEmails');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔁 Uppdatera mailcache vid uppstart
fetchLatestEmails().catch(console.error);

// ✅ GET /api/email/latest – från cache
app.get('/api/email/latest', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'email-cache.json');
    if (!fs.existsSync(filePath)) return res.json([]);
    const cache = JSON.parse(fs.readFileSync(filePath));
    res.json(cache);
  } catch (err) {
    console.error('❌ Fel vid hämtning av mailcache:', err);
    res.status(500).json({ error: 'Kunde inte hämta mail' });
  }
});

// ✅ GET /emails – direkt från Gmail
app.get('/emails', async (req, res) => {
  try {
    const emails = await fetchLatestEmails();
    res.json(emails);
  } catch (err) {
    console.error('❌ Fel i /emails:', err);
    res.status(500).json({ error: 'Kunde inte hämta mail direkt' });
  }
});

// ✅ GET /threads/:id – hämta hela tråden
app.get('/threads/:id', async (req, res) => {
  const threadId = req.params.id;
  if (!threadId) return res.status(400).json({ error: 'threadId saknas' });

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
      const to = headers.find(h => h.name === 'To')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      const extractBodyRecursive = (payload) => {
        if (payload.body?.data && (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html')) {
          return payload.body.data;
        }
        if (payload.parts) {
          for (const part of payload.parts) {
            const result = extractBodyRecursive(part);
            if (result) return result;
          }
        }
        return '';
      };

      const encodedBody = extractBodyRecursive(msg.payload);
      let decodedBody = '';
      try {
        decodedBody = Buffer.from(encodedBody, 'base64').toString('utf8');
      } catch (err) {
        decodedBody = '[Kunde inte dekoda body]';
      }

      return { from, to, date, subject, body: decodedBody };
    });

    res.json(messages);
  } catch (error) {
    console.error('❌ Fel i /threads/:id:', error);
    res.status(500).json({ error: 'Kunde inte hämta tråd' });
  }
});

// ✅ POST /api/email/reply – generera svarsutkast
app.post('/api/email/reply', async (req, res) => {
  const { to, subject, bodyPrompt } = req.body;
  try {
    const instruction = bodyPrompt || 'Svara vänligt och be om möte.';
    const prompt = `Skriv ett svar till ett mail från ${to} med ämnet "${subject}". ${instruction}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    });

    const generatedBody = completion.choices[0].message.content.trim();
    res.json({ to, subject, body: generatedBody });
  } catch (err) {
    console.error('❌ Svarsgenerering misslyckades:', err);
    res.status(500).json({ error: 'Kunde inte generera svar' });
  }
});

// ✅ POST /api/email/send-reply – skicka svar
app.post('/api/email/send-reply', async (req, res) => {
  const { to, subject, body } = req.body;

  try {
    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ];

    const rawMessage = Buffer.from(messageParts.join('\n')).toString('base64');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: rawMessage },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Fel vid skickande av mail:', err);
    res.status(500).json({ error: 'Mail kunde inte skickas' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Simon HQ backend is live on port ${PORT}`);
});
