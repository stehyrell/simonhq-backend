require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const OpenAI = require('openai');
const fetchLatestEmails = require('./fetchEmails');
const { getThread } = require('./fetchEmails');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get('/', (req, res) => {
  res.send('Simon HQ backend is running.');
});

app.get('/emails', async (req, res) => {
  try {
    const emails = await fetchLatestEmails();
    res.json(emails);
  } catch (error) {
    console.error('Fel vid hämtning av e-post:', error);
    res.status(500).json({ error: 'Kunde inte hämta e-post.' });
  }
});

app.get('/threads/:threadId', async (req, res) => {
  const { threadId } = req.params;
  try {
    const thread = await getThread(threadId);
    res.json(thread);
  } catch (error) {
    console.error('Fel vid hämtning av tråd:', error);
    res.status(500).json({ error: 'Kunde inte hämta tråd' });
  }
});

app.post('/email/reply', async (req, res) => {
  const { threadId, instruction } = req.body;
  if (!threadId || !instruction) {
    return res.status(400).json({ error: 'threadId och instruction krävs' });
  }

  try {
    const thread = await getThread(threadId);
    const messages = thread.map(msg =>
      `Från: ${msg.from}\nTill: ${msg.to}\nDatum: ${msg.date}\nÄmne: ${msg.subject}\n\n${msg.body}`
    ).join('\n\n---\n\n');

    const prompt = `
Du är en professionell assistent som hjälper till att besvara mail. Här är hela konversationen hittills:\n\n${messages}\n\nInstruktion från användaren: ${instruction}\n\nSkriv ett passande svarsutkast på svenska.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error('Fel i /email/reply:', error);
    res.status(500).json({ error: 'Kunde inte generera svar.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servern är igång på port ${PORT}`);
});
