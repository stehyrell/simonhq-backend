const { google } = require('googleapis');
const { decode } = require('html-entities');

const gmail = google.gmail('v1');
const AUTH = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
AUTH.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

function decodeBody(payload) {
  if (!payload) return '';
  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return decode(decoded);
  } catch {
    return '';
  }
}

function getHeader(headers, name) {
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

async function fetchEmails() {
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 20,
    q: 'to:simon@yran.se',
    auth: AUTH
  });

  const emails = [];

  for (const msg of res.data.messages || []) {
    const { data } = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
      auth: AUTH
    });

    const headers = data.payload.headers;
    const from = getHeader(headers, 'From');
    const to = getHeader(headers, 'To');
    const subject = getHeader(headers, 'Subject');
    const date = getHeader(headers, 'Date');

    let body = '';
    const parts = data.payload.parts || [data.payload];
    for (const part of parts) {
      if (part.mimeType === 'text/html' && part.body.data) {
        body = decodeBody(part.body.data);
        break;
      } else if (part.mimeType === 'text/plain' && part.body.data && !body) {
        body = decodeBody(part.body.data);
      }
    }

    if (!body && data.payload.body?.data) {
      body = decodeBody(data.payload.body.data);
    }

    console.log(`📨 HÄMTAT: ${subject}`);
    console.log(`BODY PREVIEW: ${body.substring(0, 120)}...`);

    emails.push({ from, to, subject, date, body });
  }

  return emails;
}

module.exports = fetchEmails;
