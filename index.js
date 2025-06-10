require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetchEmails = require('./fetchEmails');
const { OpenAI } = require('openai');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(bodyParser.json());

// 1) Fetch emails & threads
app.get('/emails', async (req, res) => {
  try {
    const emails = await fetchEmails.listThreads();  // implementerat i fetchEmails.js
    res.json(emails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

app.get('/threads/:threadId', async (req, res) => {
  try {
    const thread = await fetchEmails.getThread(req.params.threadId);
    res.json(thread);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

// 2) Generera AI-svar
app.post('/email/reply', async (req, res) => {
  const { threadId, instruction } = req.body;
  try {
    const thread = await fetchEmails.getThread(threadId);
    const content = thread.messages.map(m => m.body).join('\n\n');
    const prompt = `${instruction || 'Write a polite reply to this email:'}\n\n${content}`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ draft: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI generation failed' });
  }
});

// 3) Skicka mail
app.post('/email/send-reply', async (req, res) => {
  const { threadId, draft } = req.body;
  try {
    // Hämta originalmottagare från tråden
    const thread = await fetchEmails.getThread(threadId);
    const to = thread.messages[0].from;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: `Re: ${thread.subject}`,
      text: draft
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// 4) Spara utkast
app.put('/email/drafts/:threadId', async (req, res) => {
  const { threadId } = req.params;
  const { draft } = req.body;
  try {
    // Implementera egen lagring, t.ex. Notion, fil eller databas. Här mock:
    await saveDraft(threadId, draft);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// Starta server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Mock-funktion (lägg in riktig Notion/database-integration här)
async function saveDraft(threadId, draft) {
  // t.ex. skriv till en JSON-fil eller databas
  const fs = require('fs').promises;
  await fs.writeFile(`draft_${threadId}.txt`, draft, 'utf8');
}
