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

// Gmail-auth setup
const auth = new google.auth.OAuth2();
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth });

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * GET /emails – hämta senaste mailen
 */
app.get('/emails', async (req, res) => {
  try {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 10
    });

    if (!data.messages) return res.json([]);

    const messagePromises = data.messages.map(async (msg) => {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });

      const payload = full.data.payload;
      const headers = payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || '(utan ämne)';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const to = headers.find(h => h.name === 'To')?.value || '';
      const threadId = full.data.threadId;
      const isReplied = !!full.data.labelIds?.includes('SENT');

      let body = '';
      if (payload.parts) {
        const part = payload.parts.find(p => p.mimeType === 'text/plain');
        if (part?.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf8');
        }
      } else if (payload.body?.data) {
        body = Buffer.from(payload.body.data, 'base64').toString('utf8');
      }

      return {
        id: msg.id,
        threadId,
        from: parseEmailAddress(from),
        to,
        subject,
        body,
        bodyType: 'text',
        isReplied,
        receivedAt: full.data.internalDate
      };
    });

    const messages = await Promise.all(messagePromises);
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Fel vid hämtning av mail' });
  }
});

function parseEmailAddress(str) {
  const match = str.match(/(.*)<(.*)>/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  } else {
    return { name: str, email: str };
  }
}

/**
 * POST /email/reply – generera AI-svar från tråd
 */
app.post('/email/reply', async (req, res) => {
  try {
    const { threadId, instruction } = req.body;
    if (!threadId || !instruction) {
      return res.status(400).json({ message: 'threadId och instruction krävs' });
    }

    const { data: thread } = await gmail.users.threads.get({
      userId: 'me', id: threadId, format: 'full'
    });

    const messages = thread.messages || [];
    const conversation = messages.map(m => {
      const body = m.payload.parts
        ? m.payload.parts.find(p => p.mimeType === 'text/plain')?.body.data || ''
        : m.snippet;
      return `User: ${Buffer.from(body, 'base64').toString('utf8')}`;
    }).join('\n');

    const prompt = `${conversation}\n\nInstruktion: ${instruction}`;

    const gptRes = await openai.chat.completions.create({
      model: 'gpt-4o',
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
 * POST /email/send-reply – skicka svar
 */
app.post('/email/send-reply', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ message: 'to, subject och body krävs' });
    }

    const raw = Buffer.from(
      `From: me\nTo: ${to}\nSubject: ${subject}\n\n${body}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      resource: { raw }
    });

    return res.json({ message: 'Mail skickat!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Fel vid utskick av mail' });
  }
});

/**
 * PUT /email/drafts/:threadId – spara utkast
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
 * GET /threads/:threadId – hämta tråd
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
  console.log(`✅ Server listening on port ${PORT}`);
});
