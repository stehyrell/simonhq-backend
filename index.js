const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');

require('dotenv').config();
const fetchEmails = require('./fetchEmails');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(bodyParser.json());

let emailCache = [];

const loadEmailCache = () => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'email-cache.json'), 'utf8');
    emailCache = JSON.parse(data);
  } catch {
    emailCache = [];
  }
};

const saveEmailCache = () => {
  fs.writeFileSync(path.join(__dirname, 'email-cache.json'), JSON.stringify(emailCache, null, 2));
};

app.get('/api/email/latest', async (req, res) => {
  await fetchEmails();
  loadEmailCache();
  res.json(emailCache);
});

app.post('/api/email/reply', async (req, res) => {
  try {
    loadEmailCache();
    const instruction = req.body.instruction || 'Svara vänligt.';
    const email = emailCache.find((mail) => !mail.isReplied);

    if (!email) return res.status(404).json({ error: 'Inget obemött mail hittades.' });

    const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
    const openai = new OpenAIApi(configuration);

    const completion = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Du är en professionell kommunikatör. Skriv ett artigt, välformulerat svar på följande mail, enligt instruktionen: "${instruction}"`,
        },
        {
          role: 'user',
          content: `Från: ${email.from.name} <${email.from.email}>\nÄmne: ${email.subject}\n\n${email.body}`,
        },
      ],
    });

    const reply = completion.data.choices[0].message.content;

    // ✅ Markera som besvarat
    email.isReplied = true;
    saveEmailCache();

    // 🧠 Spara i historik
    const history = fs.existsSync('email-history.json')
      ? JSON.parse(fs.readFileSync('email-history.json', 'utf8'))
      : [];
    history.push({
      id: email.id,
      to: email.from.email,
      subject: `Svar på: ${email.subject}`,
      body: reply,
      repliedAt: new Date().toISOString(),
      instruction,
    });
    fs.writeFileSync('email-history.json', JSON.stringify(history, null, 2));

    res.json({ reply });
  } catch (error) {
    console.error('❌ Reply error:', error);
    res.status(500).json({ error: 'Kunde inte generera eller spara svar.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servern är igång på port ${PORT}`);
});
