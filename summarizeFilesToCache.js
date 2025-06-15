
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { GoogleAuth } = require('google-auth-library');

async function summarizeFilesToCache(files) {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth });

  const documents = [];

  for (const file of files) {
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

      const summary = text.slice(0, 1000); // ✂️ Förenklad sammanfattning

      documents.push({
        id: file.id,
        filename: file.name,
        summary: summary.trim()
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
