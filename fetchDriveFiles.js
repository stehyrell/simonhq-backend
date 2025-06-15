const { google } = require('googleapis');

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

async function fetchDriveFiles() {
  try {
    const authClient = await auth.getClient();
    const driveInstance = google.drive({ version: 'v3', auth: authClient });

    const response = await driveInstance.files.list({
      q: "'1ABC234DEFG567HIJKL890MNOPQ' in parents and trashed = false", // justera vid behov
      fields: 'files(id, name, mimeType, modifiedTime, size)',
      pageSize: 1000,
    });

    const files = response.data.files || [];
    console.log(`📥 Hämtade ${files.length} filer från Google Drive.`);
    return files;
  } catch (err) {
    console.error('❌ Fel vid hämtning av Drive-filer:', err);
    return [];
  }
}

module.exports = { fetchDriveFiles };
