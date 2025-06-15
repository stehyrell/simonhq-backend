
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { updateProgress } = require('./driveProgress');

async function summarizeFilesToCache(files) {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

  const drive = google.drive({ version: 'v3', auth });
  const documents = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    try {
      const result = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      let text = '';
      if (file.mimeType.includes('wordprocessingml.document')) {
        const docResult = await mammoth.extractRawText({ buffer: Buffer.from(result.data) });
        text = docResult.value;
      } else if (file.mimeType === 'application/pdf') {
        const pdfData = await pdfParse(Buffer.from(result.data));
        text = pdfData.text;
      }

      const summary = text.slice(0, 1000);

      documents.push({
        id: file.id,
        filename: file.name,
        summary: summary.trim()
      });

      updateProgress({
        total: files.length,
        completed: documents.length,
        lastFile: file.name,
        downloadedBytes: result.data.byteLength,
        currentPage: Math.floor(i / 1000) + 1
      });

    } catch (err) {
      console.error(`❌ Kunde inte sammanfatta fil: ${file.name}`, err);
    }
  }

  const cacheData = {
    lastUpdated: new Date().toISOString(),
    totalFiles: documents.length,
    totalSize: documents.reduce((acc, d) => acc + d.summary.length, 0),
    documents
  };

  const cachePath = path.resolve('./yran_brain.json');
  fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf8');

  return documents;
}

module.exports = { summarizeFilesToCache };
