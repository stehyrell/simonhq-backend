const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/drive.readonly']
});

async function fetchDriveFiles() {
  const client = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: client });

  let files = [];
  let pageToken = null;

  do {
    const res = await drive.files.list({
      q: "mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.google-apps.document'",
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      pageSize: 1000,
      pageToken
    });

    files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return files;
}

module.exports = { fetchDriveFiles };
