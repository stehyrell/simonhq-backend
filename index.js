require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OpenAI } = require('openai');
const { Client } = require('@notionhq/client');

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

app.get('/emails', async (req, res) => {
  try {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10,
      q: 'to:simon@yran.se'
    });

    const messages = data.messages || [];
    const result = [];

    for (const message of messages) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full'
      });

      const headers = msg.data.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const body = msg.data.snippet || '';

      result.push({
        id: message.id,
        threadId: msg.data.threadId,
        from: { name: from, email: from },
        to: 'simon@yran.se',
        subject,
        body,
        bodyType: 'text',
        receivedAt: new Date(Number(msg.data.internalDate)).toISOString(),
        isReplied: false
      });
    }

    res.json(result);
  } catch (err) {
    console.error('❌ Fel vid hämtning av mail:', err);
    res.status(500).json({ message: 'Fel vid hämtning av mail', error: err.message });
  }
});

app.post('/email/reply', async (req, res) => {
  let { threadId, prompt, systemPrompt, source = 'email', tag = '', subject = '' } = req.body;

  if (!prompt && req.body.instruction) {
    prompt = req.body.instruction;
  }

  if (!threadId || !prompt) {
    return res.status(400).json({ error: "threadId och prompt krävs" });
  }

  try {
    let messages = [];

    const isStandalone = threadId === 'yran-brain-chat' || threadId === 'yranbrain-direct';

    if (isStandalone) {
      messages = ["(Detta är en fristående fråga till Yran Brain – ingen tidigare mailkonversation)"];
    } else {
      const thread = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full'
      });

      messages = thread.data.messages.map(msg => {
        const body = msg.payload.parts?.[0]?.body?.data
          ? Buffer.from(msg.payload.parts[0].body.data, 'base64').toString('utf8')
          : '';
        const from = msg.payload.headers.find(h => h.name === 'From')?.value || '';
        const subject = msg.payload.headers.find(h => h.name === 'Subject')?.value || '';
        return `Från: ${from}\nÄmne: ${subject}\n${body}`;
      });
    }

    const chatPrompt = `
Tidigare konversation:
${messages.join('\n\n')}

Skriv ett svar enligt följande instruktion:
${prompt}
    `;

    const finalPayload = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt || 'Du är en assistent som svarar på mail.' },
        { role: 'user', content: chatPrompt }
      ],
      temperature: 0.7
    };

    gptPayloadHistory.unshift(finalPayload);
    gptPayloadHistory.splice(10);

    const completion = await openai.chat.completions.create(finalPayload);
    const reply = completion.choices[0]?.message?.content || '';

    try {
      await notion.pages.create({
        parent: { database_id: process.env.NOTION_YRAN_LOG_DB_ID },
        properties: {
          Name: { title: [{ text: { content: subject || "GPT-svar" } }] },
          Källa: { select: { name: source } },
          Tagg: tag ? { multi_select: [{ name: tag }] } : undefined,
          datum: { date: { start: new Date().toISOString() } }
        },
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: `Fråga: ${prompt}` } }]
            }
          },
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: `Svar: ${reply}` } }]
            }
          },
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: `Systemprompt: ${systemPrompt}` } }]
            }
          }
        ]
      });
    } catch (logErr) {
      console.error("⚠️ Kunde inte logga till Notion:", logErr);
    }

    res.json({ reply });
  } catch (err) {
    console.error("❌ GPT-svar misslyckades:", err);
    res.status(500).json({ message: 'GPT-fel', error: err.message });
  }
});

app.post('/email/send-reply', async (req, res) => {
  res.json({ message: "🔧 E-postsvar skickat (simulerat i denna version)" });
});

app.get('/ai/yran/context', (req, res) => {
  const contextPath = path.join(__dirname, 'yran_brain.json');
  fs.readFile(contextPath, 'utf8', (err, data) => {
    if (err) {
      console.error("❌ Kunde inte läsa yran_brain.json:", err);
      return res.status(500).json({ error: 'Kunde inte läsa Yran Brain' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  });
});

app.get('/debug/gpt-payload', (req, res) => {
  res.json({ history: gptPayloadHistory });
});

app.post('/log-test', async (req, res) => {
  try {
    await notion.pages.create({
      parent: { database_id: process.env.NOTION_YRAN_LOG_DB_ID },
      properties: {
        Name: { title: [{ text: { content: '🧪 Testlogg från /log-test' } }] },
        Källa: { select: { name: 'test' } },
        datum: { date: { start: new Date().toISOString() } }
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: 'Detta är en testlogg för att verifiera att Notion-integrationen fungerar.' } }]
          }
        }
      ]
    });

    res.status(200).json({ message: '✅ Lyckad testloggning till Notion!' });
  } catch (error) {
    console.error('❌ Testloggning misslyckades:', error);
    res.status(500).json({ error: 'Loggning till Notion misslyckades.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server live på port ${PORT}`);
});
