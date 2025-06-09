require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- OPENAI INIT ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// --- GMAIL AUTH ---
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

// --- HÄMTA SENASTE MAIL TILL simon@yran.se ---
app.get('/api/email/latest', async (req, res) => {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const inbox = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 5
    });

    const relevantMessages = inbox.data.messages || [];

    const emailData = await Promise.all(
      relevantMessages.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id
        });

        const headers = detail.data.payload.headers;
        const toHeader = headers.find(h => h.name === 'To')?.value || '';
        if (!toHeader.includes('simon@yran.se')) return null;

        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const fromHeader = headers.find(h => h.name === 'From')?.value || '';
        const match = fromHeader.match(/(.*) <(.*)>/);
        const fromName = match ? match[1].trim() : fromHeader;
        const fromEmail = match ? match[2].trim() : fromHeader;

        let body = '';
        const parts = detail.data.payload.parts || [];
        const textPart = parts.find(p => p.mimeType === 'text/plain');
        const htmlPart = parts.find(p => p.mimeType === 'text/html');

        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        } else if (htmlPart?.body?.data) {
          const rawHtml = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
          body = rawHtml.replace(/<\/?[^>]+(>|$)/g, '').replace(/\s+/g, ' ').trim();
        }

        return {
          id: uuidv4(),
          from: { name: fromName, email: fromEmail },
          subject,
          body,
          receivedAt: new Date(Number(detail.data.internalDate)).toISOString(),
          isReplied: false
        };
      })
    );

    const filtered = emailData.filter(Boolean);
    res.json({ emails: filtered.slice(0, 1) });
  } catch (error) {
    console.error('🔴 FULL ERROR:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    res.status(500).json({ error: 'Fetching email failed' });
  }
});

// --- GENERERA SVAR PÅ MAIL SOM UTKAST ---
app.post('/api/email/reply', async (req, res) => {
  const { to, subject, bodyPrompt } = req.body;

  try {
    const prompt = `Skriv ett professionellt, personligt och relevant mailsvar på svenska till: ${to}. Ämne: "${subject}". Instruktion: ${bodyPrompt}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }]
    });

    const reply = completion.choices[0].message.content.trim();

    res.json({
      draft: {
        to,
        subject,
        body: reply
      }
    });
  } catch (err) {
    console.error('Failed to generate reply:', err);
    res.status(500).json({ error: "Reply draft failed" });
  }
});

// --- MOCK: PARTNERSEARCH ---
app.post('/api/partner/search', (req, res) => {
  const { category, location } = req.body;
  const mockCompanies = [
    {
      id: "redbull-123",
      name: "Red Bull Sweden",
      description: "Energy drinks and extreme sports",
      category,
      location
    },
    {
      id: "monster-456",
      name: "Monster Energy",
      description: "Edgy energy drink for festivals",
      category,
      location
    }
  ];
  res.json({ companies: mockCompanies });
});

// --- MOCK: COMPANY DETAILS ---
app.get('/api/partner/company/:id', (req, res) => {
  const { id } = req.params;
  const companyDetails = {
    id,
    name: id === "redbull-123" ? "Red Bull Sweden" : "Monster Energy",
    industry: "Beverages",
    description: "High-energy drinks for active lifestyles.",
    website: "https://example.com",
    contacts: [
      {
        name: "Anna Eriksson",
        title: "Marketing Director",
        email: "anna@example.com",
        linkedin: "https://linkedin.com/in/anna"
      }
    ]
  };
  res.json(companyDetails);
});

// --- OPENAI EMAILDRAFT MOCK ---
app.post('/api/partner/email-draft', async (req, res) => {
  const { companyId, angle } = req.body;
  try {
    const prompt = `Skriv ett professionellt men personligt pitchmail på svenska till ett företag (${companyId}) som handlar om: ${angle}`;
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }]
    });

    res.json({
      subject: `Förslag på samarbete med ${companyId}`,
      body: completion.choices[0].message.content.trim()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Email draft generation failed" });
  }
});

// --- STARTA SERVER ---
app.listen(PORT, () => {
  console.log(`✅ Simon HQ backend is live on port ${PORT}`);
});
