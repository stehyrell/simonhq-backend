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
    fields: 'files(id, name, mimeType, createdTime)'
  });

  return files.files;
};

const summarizeFilesToCache = async (files) => {
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
      return {
        filename: file.name,
        type: file.mimeType,
        summary,
        scannedAt: new Date().toISOString()
      };
    })
  );

  const cachePath = path.join(__dirname, 'yran_brain.json');
  fs.writeFileSync(cachePath, JSON.stringify({ documents: summaries, lastUpdated: new Date().toISOString() }, null, 2));
  return summaries;
};

app.post('/drive/fetch-remote', async (req, res) => {
  try {
    const files = await fetchDriveFiles();
    const result = await summarizeFilesToCache(files);
    res.json({ documents: result });
  } catch (err) {
    console.error('❌ Google Drive API-fel:', err);
    res.status(500).json({ error: 'Kunde inte hämta och sammanfatta filer från Drive' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server live på port ${PORT}`);
});
