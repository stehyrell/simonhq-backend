require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// Gmail-auth setup (antag att du redan har detta konfigurerat)
const auth = new google.auth.OAuth2();
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth });

/**
 * 1) Generera AI-svar på hel tråd
 * POST /email/reply
 * Body: { threadId: string, instruction: string }
 * Response: { reply: string }
 */
app.post('/email/reply', async (req, res) => {
  try {
    const { threadId, instruction } = req.body;
    if (!threadId || !instruction) {
      return res.status(400).json({ message: 'threadId och instruction krävs' });
    }
    // Hämta hela trådens meddelanden
    const { data: thread } = await gmail.users.threads.get({
      userId: 'me', id: threadId, format: 'full'
    });
    const messages = thread.messages || [];
    // Skapa ett prompt ur meddelandena + instruktionen
    const conversation = messages.map(m => {
      const body = m.payload.parts
        ? m.payload.parts.find(p => p.mimeType === 'text/plain')?.body.data || ''
        : m.snippet;
      return `User: ${Buffer.from(body, 'base64').toString('utf8')}`;
    }).join('\n');
    const prompt = `${conversation}\n\nInstruktion: ${instruction}`;
    // Anropa OpenAI (byt ut med din kod)
    const openai = require('openai');
    openai.apiKey = process.env.OPENAI_API_KEY;
    const gptRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    });
    const reply = gptRes.choices[0].message.content;
    return res.json({ reply });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Fel vid AI-generering' });
  }
});

/**
 * 2) Skicka mail-svarsutkast
 * POST /email/send-reply
 * Body: { to: string, subject: string, body: string }
 */
app.post('/email/send-reply', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ message: 'to, subject och body krävs' });
    }
    // Bygg MIME
    const raw = Buffer.from(
      `From: me\nTo: ${to}\nSubject: ${subject}\n\n${body}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', resource: { raw } });
    return res.json({ message: 'Mail skickat!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Fel vid utskick av mail' });
  }
});

/**
 * 3) Spara utkast
 * PUT /email/drafts/:threadId
 * Body: { draft: string }
 */
app.put('/email/drafts/:threadId', (req, res) => {
  try {
    const { threadId } = req.params;
    const { draft } = req.body;
    const dir = path.join(__dirname, 'drafts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `${threadId}.json`), JSON.stringify({ draft }, null, 2));
    return res.json({ message: 'Utkast sparat!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Fel vid sparning av utkast' });
  }
});

/**
 * 4) Hämta tråd
 * GET /threads/:threadId
 */
app.get('/threads/:threadId', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { data } = await gmail.users.threads.get({
      userId: 'me', id: threadId, format: 'full'
    });
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Fel vid hämtning av tråd' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
