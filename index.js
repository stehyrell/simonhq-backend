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

// === /log-to-notion ===
app.post('/log-to-notion', async (req, res) => {
  const { title, källa, tagg, innehåll } = req.body;
  try {
    await notion.pages.create({
      parent: { database_id: process.env.NOTION_YRAN_LOG_DB_ID },
      properties: {
        Name: { title: [{ text: { content: title || 'Logg utan titel' } }] },
        Källa: { select: { name: källa || 'manual' } },
        Tagg: tagg ? { multi_select: tagg.map(t => ({ name: t })) } : undefined,
        datum: { date: { start: new Date().toISOString() } }
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: innehåll || 'Ingen text angiven.' } }
            ]
          }
        }
      ]
    });
    res.status(200).json({ message: '✅ Loggad till Notion via /log-to-notion' });
  } catch (err) {
    console.error('❌ Fel vid loggning via /log-to-notion:', err);
    res.status(500).json({ error: 'Loggning till Notion misslyckades.' });
  }
});

// === /drive/context ===
app.get('/drive/context', async (req, res) => {
  const folderPath = path.join(__dirname, 'drive', 'SimonHQ_YranBrain');
  try {
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

    res.json({ documents: context, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Fel vid /drive/context:', err);
    res.status(500).json({ error: 'Kunde inte hämta Drive-sammanhang.' });
  }
});

// === /notion/logs ===
app.get('/notion/logs', async (req, res) => {
  const dbId = process.env.NOTION_YRAN_LOG_DB_ID;
  const sourceFilter = req.query.source;

  try {
    const response = await notion.databases.query({
      database_id: dbId,
      filter: sourceFilter ? {
        property: 'Källa',
        select: { equals: sourceFilter }
      } : undefined
    });

    const logs = response.results.map(page => {
      const props = page.properties;
      return {
        id: page.id,
        title: props.Name?.title?.[0]?.text?.content || '(utan titel)',
        date: props.datum?.date?.start || null,
        source: props.Källa?.select?.name || null,
        tag: props.Tagg?.multi_select?.map(t => t.name) || []
      };
    });

    res.json({ logs });
  } catch (err) {
    console.error('❌ Fel vid /notion/logs:', err);
    res.status(500).json({ error: 'Kunde inte hämta Notion-loggar.' });
  }
});

// === /test ===
app.get('/test', async (req, res) => {
  try {
    const notionPing = await notion.search({ page_size: 1 });
    const driveExists = fs.existsSync(path.join(__dirname, 'drive', 'SimonHQ_YranBrain'));
    res.json({
      notion: notionPing?.results?.length >= 0 ? '✅ OK' : '⚠️ Empty',
      drive: driveExists ? '✅ Found SimonHQ_YranBrain folder' : '❌ Missing folder',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('❌ Fel vid /test:', err);
    res.status(500).json({ error: 'Test misslyckades.', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server live på port ${PORT}`);
});
