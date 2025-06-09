const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

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
      maxResults: 10
    });

    if (!inbox.data.messages || inbox.data.messages.length === 0) {
      console.log('📭 Inga nya mail hittades.');
      return [];
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

        // Hämta text/plain först, annars fallback till text/html
        const getEmailBody = (payload) => {
          const parts = payload.parts || [];
          for (const part of parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              return part.body.data;
            }
          }
          for (const part of parts) {
            if (part.mimeType === 'text/html' && part.body?.data) {
              return part.body.data;
            }
          }
          return payload.body?.data || '';
        };

        const encodedBody = getEmailBody(msgData.data.payload);
        let decodedBody = '';
        try {
          decodedBody = Buffer.from(encodedBody, 'base64').toString('utf8');
        } catch (err) {
          console.warn('⚠️ Kunde inte dekoda body:', err.message);
        }

        const email = {
          id: uuidv4(),
          from: { name: fromName, email: fromEmail },
          to: toHeader,
          subject,
          body: decodedBody,
          receivedAt: new Date(Number(msgData.data.internalDate)).toISOString(),
          isReplied: false
        };

        console.log(`📨 HÄMTAT: ${subject}`);
        console.log(`BODY: ${decodedBody.substring(0, 100)}...`);

        return email;
      })
    );

    const relevant = emailData.filter(mail =>
      mail.to?.toLowerCase().includes('simon@yran.se')
    );

    fs.writeFileSync(
      path.join(__dirname, 'email-cache.json'),
      JSON.stringify(relevant, null, 2)
    );

    console.log(`✅ Sparat ${relevant.length} relevanta mail till cache`);
    return relevant;
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
