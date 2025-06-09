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

const fetchEmails = async () => {
  try {
    const inbox = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 15
    });

    if (!inbox.data.messages || inbox.data.messages.length === 0) {
      console.log('📭 Inga nya mail hittades.');
      return [];
    }

    const extractBodyRecursive = (payload) => {
      if (!payload) return '';
      if (payload.body?.data && (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html')) {
        return payload.body.data;
      }
      if (payload.parts && Array.isArray(payload.parts)) {
        for (const part of payload.parts) {
          const result = extractBodyRecursive(part);
          if (result) return result;
        }
      }
      return '';
    };

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

        const encodedBody = extractBodyRecursive(msgData.data.payload);
        let decodedBody = '';
        try {
          decodedBody = decode(Buffer.from(encodedBody, 'base64').toString('utf8'));
        } catch (err) {
          console.warn(`⚠️ Kunde inte dekoda body för mail "${subject}":`, err.message);
        }

        const bodyType = decodedBody.includes('<html') || decodedBody.includes('<div') || decodedBody.includes('<p') ? 'html' : 'text';

        const email = {
          id: uuidv4(),
          threadId: msgData.data.threadId,
          from: { name: fromName, email: fromEmail },
          to: toHeader,
          subject,
          body: decodedBody,
          bodyType,
          receivedAt: new Date(Number(msgData.data.internalDate)).toISOString(),
          isReplied: false
        };

        if (toHeader.toLowerCase().includes('simon@yran.se')) {
          console.log(`📨 ${subject} | BODY(${bodyType}) length: ${decodedBody.length}`);
          return email;
        } else {
          return null;
        }
      })
    );

    const filtered = emailData.filter(e => e !== null);

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

module.exports = fetchEmails;
