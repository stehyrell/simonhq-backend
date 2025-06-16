const { google } = require('googleapis');

async function fetchDriveFiles() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );

  auth.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });

  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.list({
    q: "mimeType = 'application/pdf' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    pageSize: 200
  });

  const files = response.data.files || [];
  console.log(`📥 Antal filer hämtade från Drive: ${files.length}`);
  return files;
}

module.exports = { fetchDriveFiles };
