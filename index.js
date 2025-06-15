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
const { GoogleAuth } = require('google-auth-library');
const cron = require('node-cron');

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

const logToNotion = async ({ title, källa, taggar = [], datum = null }) => {
  try {
    const dbId = process.env.NOTION_YRAN_LOG_DB_ID;
    await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        Name: { title: [{ text: { content: title } }] },
        Källa: { select: { name: källa } },
        Tagg: { multi_select: taggar.map(t => ({ name: t })) },
        datum: { date: { start: datum || new Date().toISOString() } }
      }
    });
  } catch (err) {
    console.error('❌ Kunde inte logga till Notion:', err.message);
  }
};

const fetchDriveFiles = async () => {
  let credentials;
  try {
    credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_BASE64, 'base64').toString('utf8')
    );
  } catch (e) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON är ogiltig eller saknas');
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  const drive = google.drive({ version: 'v3', auth: await auth.getClient() });

  const folderName = 'SimonHQ_YranBrain';
  const { data: folderList } = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)'
  });

  if (!folderList.files.length) {
    throw new Error(`Drive-mapp '${folderName}' hittades inte.`);
  }

  const folderId = folderList.files[0].id;
  const { data: files } = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, createdTime, size)'
  });

  return files.files;
};

const summarizeFilesToCache = async (files) => {
  const now = new Date();
  console.log('🧠 Startar sammanfattning av filer...');
  const summaries = await Promise.all(
    files.map(async (file) => {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Sammanfatta innehållet kortfattat baserat på filmetadata. Om innehåll saknas, använd metadata.'
          },
          {
            role: 'user',
            content: `Filnamn: ${file.name}\nTyp: ${file.mimeType}\nSkapad: ${file.createdTime}`
          }
        ]
      });

      const summary = completion.choices?.[0]?.message?.content || '(Sammanfattning misslyckades)';

      await logToNotion({
        title: `Sammanfattning: ${file.name}`,
        källa: 'drive',
        taggar: ['Drive', 'Sammanfattning'],
        datum: file.createdTime
      });

      return {
        filename: file.name,
        type: file.mimeType,
        summary,
        scannedAt: now.toISOString(),
        size: file.size || null,
        createdTime: file.createdTime || null
      };
    })
  );

  const totalSize = summaries.reduce((sum, f) => sum + (parseInt(f.size || 0)), 0);
  const cachePath = path.resolve('./yran_brain.json');
  const cache = {
    documents: summaries,
    lastUpdated: new Date().toISOString(),
    totalFiles: summaries.length,
    totalSize,
    recentActivity: {
      scannedToday: summaries.filter(f => f.scannedAt?.startsWith(new Date().toISOString().split('T')[0])).length,
      gptResponsesToday: gptPayloadHistory.filter(p => p.createdAt?.startsWith(new Date().toISOString().split('T')[0])).length
    }
  };

  console.log('📝 Skriver yran_brain.json...');
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  console.log('✅ yran_brain.json sparad:', cachePath);
  return summaries;
};

app.post('/yran/ask', async (req, res) => {
  try {
    const { prompt } = req.body;
    const contextPath = path.resolve('./yran_brain.json');
    const contextData = fs.existsSync(contextPath) ? JSON.parse(fs.readFileSync(contextPath, 'utf8')) : null;
    const systemPrompt = contextData ? `Här är relevant information från Storsjöyran:

${contextData.documents.map(doc => `📄 ${doc.filename}\n${doc.summary}`).join('\n\n')}` : '';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    });

    const reply = completion.choices?.[0]?.message?.content || '(Inget svar genererat)';

    gptPayloadHistory.push({ prompt, reply, createdAt: new Date().toISOString() });

    await logToNotion({
      title: `Svar från Yran Brain`,
      källa: 'yranbrain',
      taggar: ['Svar'],
      datum: new Date().toISOString()
    });

    res.json({ reply });
  } catch (err) {
    console.error('❌ Yran Brain-fel:', err);
    res.status(500).json({ error: 'Yran Brain kunde inte generera ett svar.' });
  }
});
