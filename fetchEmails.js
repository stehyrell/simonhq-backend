const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS = {
  client_id: process.env.GMAIL_CLIENT_ID,
  client_secret: process.env.GMAIL_CLIENT_SECRET,
  redirect_uris: ['https://developers.google.com/oauthplayground'],
};

const TOKEN = {
  refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  type: 'authorized_user',
};

const isToSimonYran = (headers) => {
  const toHeader = headers.find((h) => h.name.toLowerCase() === 'to');
  return toHeader && toHeader.value.toLowerCase().includes('simon@yran.se');
};

const fetchEmails = async () => {
  const oAuth2Client = new google.auth.OAuth2(
    CREDENTIALS.client_id,
    CREDENTIALS.client_secret,
    CREDENTIALS.redirect_uris[0]
  );
  oAuth2Client.setCredentials(TOKEN);

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 10,
    q: 'in:inbox -category:promotions -category:social',
  });

  const messages = res.data.messages || [];
  const allEmails = [];

  for (const msg of messages) {
    const msgData = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    const headers = msgData.data.payload.headers;
    if (!isToSimonYran(headers)) {
      console.log(`⛔️ Skippat mail: ej till simon@yran.se`);
      continue;
    }

    const fromHeader = headers.find((h) => h.name.toLowerCase() === 'from');
    const subjectHeader = headers.find((h) => h.name.toLowerCase() === 'subject');
    const toHeader = headers.find((h) => h.name.toLowerCase() === 'to');
    const dateHeader = headers.find((h) => h.name.toLowerCase() === 'date');

    const body =
      msgData.data.payload.parts?.[0]?.body?.data ||
      msgData.data.payload.body?.data ||
      '';
    const decodedBody = Buffer.from(body, 'base64').toString('utf8');

    allEmails.push({
      id: msg.id,
      from: {
        name: fromHeader?.value.split('<')[0].trim().replace(/"/g, ''),
        email: fromHeader?.value.match(/<(.*)>/)?.[1] || '',
      },
      to: toHeader?.value || '',
      subject: subjectHeader?.value || '(No Subject)',
      body: decodedBody,
      receivedAt: new Date(dateHeader?.value || Date.now()).toISOString(),
      isReplied: false,
    });
  }

  fs.writeFileSync(path.join(__dirname, 'email-cache.json'), JSON.stringify(allEmails, null, 2));
  console.log(`✅ Sparat ${allEmails.length} relevanta mail till cache`);
  return allEmails;
};

module.exports = fetchEmails;
