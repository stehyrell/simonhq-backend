const { google } = require('googleapis');

async function fetchDriveFiles() {
  try {
    const auth = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.list({
      // Tillfälligt inga filter – hämta ALLT som inte är i papperskorgen
      q: "trashed = false",
      fields: 'files(id, name, mimeType, modifiedTime, size)',
      pageSize: 100,
    });

    const files = response.data.files || [];
    console.log(`📥 Antal filer hämtade från Drive: ${files.length}`);
    console.log('📄 Förhandsgranskning av filer:', files.slice(0, 5));

    return files;
  } catch (err) {
    console.error('❌ Fel vid hämtning av Drive-filer:', err.message);
    return [];
  }
}

module.exports = { fetchDriveFiles };
