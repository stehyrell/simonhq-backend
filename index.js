require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OpenAI } = require('openai');
const { Client } = require('@notionhq/client');
const { fetchDriveFiles } = require('./fetchDriveFiles');
const { summarizeFilesToCache } = require('./summarizeFilesToCache');
const { updateProgress, getProgress } = require('./driveProgress');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const gptPayloadHistory = [];
const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

app.get('/', (req, res) => res.send('✅ Simon HQ backend is live.'));

app.get('/drive/status', async (req, res) => {
  try {
    const cachePath = path.resolve('./yran_brain.json');
    const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : null;
    if (!cache) return res.status(404).json({ error: 'Ingen cache hittades.' });
    const totalSizeBytes = cache.documents.reduce((sum, doc) => sum + (doc.size || 0), 0);
    res.json({
      lastUpdated: cache.lastUpdated,
      totalFiles: cache.totalFiles,
      totalSize: cache.totalSize,
      totalSizeBytes
    });
  } catch (err) {
    console.error('❌ Fel i /drive/status:', err);
    res.status(500).json({ error: 'Kunde inte läsa cache-status.' });
  }
});

app.get('/drive/context', async (req, res) => {
  try {
    const contextPath = path.resolve('./yran_brain.json');
    const contextData = fs.existsSync(contextPath) ? JSON.parse(fs.readFileSync(contextPath, 'utf8')) : null;
    if (!contextData) return res.status(404).json({ error: 'Ingen sammanfattningscache hittades.' });
    res.json(contextData);
  } catch (err) {
    console.error('❌ Fel i /drive/context:', err);
    res.status(500).json({ error: 'Misslyckades läsa dokumentkontext.' });
  }
});

app.get('/drive/files', async (req, res) => {
  try {
    const cachePath = path.resolve('./yran_brain.json');
    const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : null;
    if (!cache) return res.status(404).json({ error: 'Ingen cache hittades.' });
    res.json(cache.documents);
  } catch (err) {
    console.error('❌ Fel i /drive/files:', err);
    res.status(500).json({ error: 'Misslyckades läsa dokumentlista.' });
  }
});

app.get('/drive/progress', async (req, res) => {
  try {
    const progress = getProgress();
    if (!progress) return res.status(404).json({ error: 'Ingen progress-data tillgänglig.' });
    res.json(progress);
  } catch (err) {
    console.error('❌ Fel i /drive/progress:', err);
    res.status(500).json({ error: 'Kunde inte läsa progress-data.' });
  }
});

app.post('/drive/start-indexing', async (req, res) => {
  res.status(202).json({ status: 'Indexering startad' });

  setTimeout(async () => {
    try {
      updateProgress({ status: 'Indexering pågår...', done: false, error: null });
      const files = await fetchDriveFiles();
      await summarizeFilesToCache(files);
      updateProgress({ status: 'Indexering klar', done: true, error: null });
      console.log('✅ Indexering slutförd.');
    } catch (err) {
      console.error('❌ Async indexering misslyckades:', err);
      updateProgress({ status: 'Fel vid indexering', done: true, error: err.message });
    }
  }, 500);
});

app.get('/notion/logs', async (req, res) => {
  try {
    const dbId = process.env.NOTION_YRAN_LOG_DB_ID;
    const response = await notion.databases.query({
      database_id: dbId,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 15
    });
    res.json(response.results.map(r => ({
      name: r.properties?.Name?.title?.[0]?.text?.content || '(Namnlös)',
      källa: r.properties?.Källa?.select?.name || '',
      taggar: r.properties?.Tagg?.multi_select?.map(t => t.name) || [],
      datum: r.properties?.datum?.date?.start || r.created_time
    })));
  } catch (err) {
    console.error('❌ Fel i /notion/logs:', err);
    res.status(500).json({ error: 'Kunde inte hämta loggar från Notion.' });
  }
});

app.post('/log-gpt-reply', async (req, res) => {
  try {
    const { prompt, reply } = req.body;
    gptPayloadHistory.push({ prompt, reply, createdAt: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Fel vid loggning av GPT-svar:', err);
    res.status(500).json({ error: 'Misslyckades logga GPT-svar.' });
  }
});

app.post('/yran/ask', async (req, res) => {
  try {
    const { prompt } = req.body;
    const contextPath = path.resolve('./yran_brain.json');
    const contextData = fs.existsSync(contextPath) ? JSON.parse(fs.readFileSync(contextPath, 'utf8')) : null;
    const systemPrompt = contextData
      ? `Här är relevant information från Storsjöyran:\n\n${contextData.documents.map(doc => `📄 ${doc.filename}\n${doc.summary}`).join('\n\n')}`
      : '';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    });

    const reply = completion.choices?.[0]?.message?.content || '(Inget svar genererat)';
    gptPayloadHistory.push({ prompt, reply, createdAt: new Date().toISOString() });

    await notion.pages.create({
      parent: { database_id: process.env.NOTION_YRAN_LOG_DB_ID },
      properties: {
        Name: { title: [{ text: { content: `Svar från Yran Brain` } }] },
        Källa: { select: { name: 'yranbrain' } },
        Tagg: { multi_select: [{ name: 'Svar' }] },
        datum: { date: { start: new Date().toISOString() } }
      }
    });

    res.json({ reply });
  } catch (err) {
    console.error('❌ Yran Brain-fel:', err);
    res.status(500).json({ error: 'Yran Brain kunde inte generera ett svar.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servern körs på port ${PORT}`);
});
