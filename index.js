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

// --- EMAIL: SENASTE MEDDELANDE ---
app.get('/api/email/latest', async (req, res) => {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const inbox = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 1
    });

    const message = inbox.data.messages?.[0];
    if (!message) {
      return res.status(404).json({ error: 'No emails found' });
    }

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
    const body = Buffer.from(
      detail.data.payload.parts?.find(p => p.mimeType === 'text/plain')?.body?.data || '',
      'base64'
    ).toString('utf-8');

    res.json({
      id: uuidv4(),
      from: { name: fromName, email: fromEmail },
      subject,
      body,
      receivedAt: new Date(Number(detail.data.internalDate)).toISOString(),
      isReplied: false
    });
  } catch (error) {
    console.error('🔴 FULL ERROR:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    res.status(500).json({ error: 'Fetching email failed' });
  }
});

// --- SKICKA SVAR ---
app.post('/api/email/send-reply', async (req, res) => {
  const { to, subject, body } = req.body;

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

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to send email:', err);
    res.status(500).json({ error: 'Email sending failed' });
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

// --- OPENAI EMAILDRAFT ---
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
