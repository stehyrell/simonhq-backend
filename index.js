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
  const cachePath = path.join(__dirname, 'yran_brain.json');
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
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  return summaries;
};

app.post('/log-gpt-reply', async (req, res) => {
  try {
    const { title, tags } = req.body;
    await logToNotion({
      title: title || 'Svarsutkast via mailmodul',
      källa: 'email',
      taggar: tags || ['Mail', 'Automatiserat']
    });
    res.json({ status: 'logged' });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte logga GPT-svar' });
  }
});

app.get('/drive/status', (req, res) => {
  const cachePath = path.join(__dirname, 'yran_brain.json');
  if (!fs.existsSync(cachePath)) {
    return res.status(404).json({ error: 'Ingen cache hittades' });
  }
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  res.json({
    totalFiles: cache.totalFiles || cache.documents?.length || 0,
    lastUpdated: cache.lastUpdated || null,
    totalSizeBytes: cache.totalSize || null,
    gptResponsesToday: cache.recentActivity?.gptResponsesToday || 0,
    scannedToday: cache.recentActivity?.scannedToday || 0
  });
});

app.get('/drive/context', (req, res) => {
  const cachePath = path.join(__dirname, 'yran_brain.json');
  if (!fs.existsSync(cachePath)) {
    return res.status(404).json({ error: 'Ingen cache hittades' });
  }
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  res.json(cache.documents || []);
});

app.get('/notion/logs', async (req, res) => {
  try {
    const dbId = process.env.NOTION_YRAN_LOG_DB_ID;
    const source = req.query.source;

    const filter = source
      ? { property: 'Källa', select: { equals: source } }
      : undefined;

    const result = await notion.databases.query({
      database_id: dbId,
      filter,
      sorts: [{ property: 'datum', direction: 'descending' }]
    });

    const logs = result.results.map((page) => ({
      id: page.id,
      title: page.properties.Name?.title?.[0]?.text?.content || 'Okänd',
      källa: page.properties.Källa?.select?.name || 'Okänd',
      taggar: page.properties.Tagg?.multi_select?.map(t => t.name),
      datum: page.properties.datum?.date?.start || null
    }));

    res.json(logs);
  } catch (err) {
    console.error('❌ Kunde inte hämta loggar från Notion:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta loggar' });
  }
});

app.post('/drive/fetch-remote', async (req, res) => {
  try {
    console.log('🔄 Fetching and summarizing remote Drive files...');
    const files = await fetchDriveFiles();
    const summaries = await summarizeFilesToCache(files);
    res.json({ message: '✅ Filer hämtade och sammanfattade', summaries });
  } catch (err) {
    console.error('❌ Drive fetch/summarize error:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta och sammanfatta filer från Drive' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Simon HQ backend lyssnar på port ${PORT}`);
});