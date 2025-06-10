const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Lista trådar
async function listThreads() {
  const res = await gmail.users.threads.list({ userId: 'me', maxResults: 20 });
  return res.data.threads || [];
}

// Hämta en tråd med alla meddelanden
async function getThread(threadId) {
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full'
  });
  const messages = res.data.messages.map(msg => {
    const body = msg.payload.parts
      ? Buffer.from(msg.payload.parts[0].body.data, 'base64').toString('utf8')
      : '';
    const fromHeader = msg.payload.headers.find(h => h.name === 'From');
    const subjectHeader = msg.payload.headers.find(h => h.name === 'Subject');
    return {
      id: msg.id,
      from: fromHeader?.value,
      subject: subjectHeader?.value,
      body
    };
  });
  return {
    threadId,
    subject: messages[0].subject,
    messages
  };
}

module.exports = {
  listThreads,
  getThread
};
