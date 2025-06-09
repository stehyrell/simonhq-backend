const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const { decode } = require('html-entities');

require('dotenv').config();

const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

/**
 * Prioriterar text/plain, annars tar fallback till text/html (som stripas).
 */
const extractBody = (payload) => {
  if (!payload) return '';

  const traverseParts = (parts) => {
    for (const part of parts || []) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf8');
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf8');
        return decode(html.replace(/<\/?[^>]+(>|$)/g, ''));
      }
      if (part.parts) {
        const result = traverseParts(part.parts);
        if (result) return result;
      }
    }
    return '';
  };

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

  return traverseParts(payload.parts) || '';
};

const fetchEmails = async () => {
  try {
    const inbox = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 15
    });

    if (!inbox.data.messages || inbox.data.messages.length === 0) {
      console.log('📭 Inga nya mail hittades.');
      return;
    }

    const emailData = await Promise.all(
      inbox.data.messages.map(async (msg) => {
        const msgData = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });

        const headers = msgData.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const fromHeader = headers.find(h => h.name === 'From')?.value || '';
        const toHeader = headers.find(h => h.name === 'To')?.value || '';
        const matchFrom = fromHeader.match(/(.*) <(.*)>/);
        const fromName = matchFrom ? matchFrom[1].trim() : fromHeader;
        const fromEmail = matchFrom ? matchFrom[2].trim() : fromHeader;

        const threadId = msgData.data.threadId;

        const rawBody = extractBody(msgData.data.payload);
        const cleanedBody = decode(rawBody).trim();

        return {
          id: uuidv4(),
          threadId,
          from: { name: fromName, email: fromEmail },
          to: toHeader,
          subject,
          body: cleanedBody,
          bodyLength: cleanedBody.length,
          isHtml: false,
          receivedAt: new Date(Number(msgData.data.internalDate)).toISOString(),
          isReplied: false
        };
      })
    );

    // Endast mail till simon@yran.se
    const filtered = emailData.filter(mail =>
      mail.to?.toLowerCase().includes('simon@yran.se')
    );

    fs.writeFileSync(
      path.join(__dirname, 'email-cache.json'),
      JSON.stringify(filtered, null, 2)
    );

    console.log(`✅ Sparat ${filtered.length} mail till cache`);
    return filtered;
  } catch (error) {
    console.error('❌ FEL VID FETCH AV MAIL:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    throw error;
  }
};

const getThread = async (threadId) => {
  try {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    const messages = thread.data.messages.map(msg => {
      const headers = msg.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const to = headers.find(h => h.name === 'To')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      const body = extractBody(msg.payload);
      const cleaned = decode(body).trim();

      return {
        from,
        to,
        subject,
        date,
        body: cleaned
      };
    });

    return messages;
  } catch (err) {
    console.error('❌ Fel vid hämtning av tråd:', err);
    throw err;
  }
};

module.exports = {
  fetchEmails,
  getThread
};
