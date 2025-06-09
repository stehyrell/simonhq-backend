const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
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
      maxResults: 10,
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
          format: 'full',
        });

        const headers = msgData.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const fromHeader = headers.find(h => h.name === 'From')?.value || '';
        const toHeader = headers.find(h => h.name === 'To')?.value || '';
        const threadId = msgData.data.threadId;

        const matchFrom = fromHeader.match(/(.*) <(.*)>/);
        const fromName = matchFrom ? matchFrom[1].trim() : fromHeader;
        const fromEmail = matchFrom ? matchFrom[2].trim() : fromHeader;

        const getPlainText = (payload) => {
          if (payload.mimeType === 'text/plain' && payload.body?.data) {
            return payload.body.data;
          }
          if (payload.parts) {
            for (const part of payload.parts) {
              if (part.mimeType === 'text/plain' && part.body?.data) {
                return part.body.data;
              }
            }
          }
          return '';
        };

        const encodedBody = getPlainText(msgData.data.payload);
        let decodedBody = '';
        try {
          decodedBody = Buffer.from(encodedBody, 'base64').toString('utf8');
        } catch (err) {
          console.warn('⚠️ Kunde inte dekoda body:', err.message);
        }

        return {
          id: msg.id,
          threadId,
          from: { name: fromName, email: fromEmail },
          to: toHeader,
          subject,
          body: decodedBody,
          receivedAt: new Date(Number(msgData.data.internalDate)).toISOString(),
          isReplied: false,
        };
      })
    );

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
      response: error.response?.data,
    });
    throw error;
  }
};

async function getThread(threadId) {
  const threadMessages = [];
  try {
    const threadResponse = await gmail.users.messages.list({
      userId: 'me',
      q: `rfc822msgid:${threadId} OR threadId:${threadId}`,
    });

    const messages = threadResponse.data.messages || [];

    for (const msg of messages) {
      const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = msgData.data.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value || '';
      const to = headers.find(h => h.name === 'To')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      const getPlainText = (payload) => {
        if (payload.mimeType === 'text/plain' && payload.body?.data) {
          return payload.body.data;
        }
        if (payload.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              return part.body.data;
            }
          }
        }
        return '';
      };

      const encodedBody = getPlainText(msgData.data.payload);
      let decodedBody = '';
      try {
        decodedBody = Buffer.from(encodedBody, 'base64').toString('utf8');
      } catch (err) {
        decodedBody = '';
      }

      threadMessages.push({
        from,
        to,
        subject,
        date,
        body: decodedBody,
      });
    }

    return threadMessages;
  } catch (err) {
    console.error('❌ FEL I getThread:', err.message);
    return [];
  }
}

module.exports = {
  fetchEmails,
  getThread,
};
