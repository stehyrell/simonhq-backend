
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function fetchDriveFiles() {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: "mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 10
  });

  return res.data.files;
}

module.exports = { fetchDriveFiles };
