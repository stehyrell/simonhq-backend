require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { fetchEmails, getThread } = require('./fetchEmails');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// OpenAI-setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Hälsokontroll
app.get('/', (req, res) => {
  res.send('Simon HQ backend is running.');
});

// GET /emails – senaste mail
app.get('/emails', async (req, res) => {
  try {
    const emails = await fetchEmails();
    res.json(emails);
  } catch (error) {
    console.error('Fel vid hämtning av e-post:', error);
    res.status(500).json({ error: 'Kunde inte hämta e-post.' });
  }
});

// GET /threads/:threadId – hela mailtråden
app.get('/threads/:threadId', async (req, res) => {
  const { threadId } = req.params;
  console.log('🔍 Mottaget GET /threads with threadId=', threadId);
  try {
    const thread = await getThread(threadId);
    console.log(`🧵 Tråd innehåller ${thread.length} meddelanden`);
    res.json(thread);
  } catch (error) {
    console.error('Fel vid hämtning av tråd:', error);
    res.status(500).json({ error: 'Kunde inte hämta tråd.' });
  }
});

// POST /email/reply – generera AI-svar med hela tråden som kontext
app.post('/email/reply', async (req, res) => {
  console.log('🔍 Mottaget POST /email/reply payload:', req.body);

  const { threadId, instruction } = req.body;
  if (!threadId || !instruction) {
    console.error('⛔️ Saknas threadId eller instruction');
    return res.status(400).json({ error: 'threadId och instruction krävs' });
  }

  try {
    // Hämta hela tråden
    const thread = await getThread(threadId);
    console.log(`🧵 Thread (${thread.length} meddelanden):`, thread);

    // Bygg prompt
    const messages = thread
      .map(msg =>
        `Från: ${msg.from}\nTill: ${msg.to}\nDatum: ${msg.date}\nÄmne: ${msg.subject}\n\n${msg.body}`
      )
      .join('\n\n---\n\n');
    const prompt = `
Du är en professionell assistent som hjälper till att besvara mail. Här är hela konversationen hittills:

${messages}

Instruktion från användaren: ${instruction}

Skriv ett passande svarsutkast på svenska.
`;

    console.log('📢 GPT-prompt:', prompt);

    // Anropa OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
    });

    const reply = completion.choices[0].message.content.trim();
    console.log('✅ GPT-svar:', reply);

    return res.json({ reply });
  } catch (error) {
    console.error('❌ Fel i /email/reply:', error);
    return res.status(500).json({ error: error.message || 'Kunde inte generera svar.' });
  }
});

// Starta servern
app.listen(PORT, () => {
  console.log(`Servern är igång på port ${PORT}`);
});
