require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OpenAI } = require('openai');
const { Client } = require('@notionhq/client');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'https://preview--simon-hq-orchestra.lovable.app',
    'https://simonhq.vercel.app',
    'http://localhost:3000'
  ]
}));
app.use(express.json());

const gptPayloadHistory = [];
const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const scanDriveContext = async () => {
  const folderPath = path.join(__dirname, 'drive', 'SimonHQ_YranBrain');
  const files = fs.readdirSync(folderPath).filter(f => /\.(pdf|docx|txt|md)$/i.test(f));

  const context = await Promise.all(files.map(async filename => {
    const filePath = path.join(folderPath, filename);
    let fileContent = '';

    try {
      if (/\.pdf$/i.test(filename)) {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        fileContent = data.text;
      } else if (/\.docx$/i.test(filename)) {
        const result = await mammoth.extractRawText({ path: filePath });
        fileContent = result.value;
      } else {
        fileContent = fs.readFileSync(filePath, 'utf-8');
      }
    } catch {
      fileContent = '(Kunde inte läsa innehållet)';
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Sammanfatta innehållet kortfattat för en AI-assistent som hjälper till att svara på frågor om Storsjöyran.'
        },
        { role: 'user', content: fileContent.slice(0, 8000) }
      ]
    });

    const summary = completion.choices?.[0]?.message?.content || '(Sammanfattning misslyckades)';
    return {
      filename,
      type: path.extname(filename).slice(1),
      summary,
      scannedAt: new Date().toISOString()
    };
  }));

  const cachePath = path.join(__dirname, 'yran_brain.json');
  fs.writeFileSync(cachePath, JSON.stringify({ documents: context, lastUpdated: new Date().toISOString() }, null, 2));
  return context;
};

// === /drive/context/preview ===
app.get('/drive/context/preview', async (req, res) => {
  try {
    const context = await scanDriveContext();
    res.json({ documents: context, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Fel vid /drive/context/preview:', err);
    res.status(500).json({ error: 'Kunde inte generera preview.' });
  }
});

// === /drive/context ===
app.get('/drive/context', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'yran_brain.json');
    if (!fs.existsSync(cachePath)) throw new Error('Cachefil saknas');
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    res.json(cached);
  } catch (err) {
    console.error('❌ Fel vid /drive/context:', err);
    res.status(500).json({ error: 'Kunde inte hämta dokumentkontext.' });
  }
});

// === /drive/refresh ===
app.post('/drive/refresh', async (req, res) => {
  try {
    const updated = await scanDriveContext();
    res.json({ documents: updated, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Fel vid /drive/refresh:', err);
    res.status(500).json({ error: 'Kunde inte uppdatera kontext.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server live på port ${PORT}`);
});