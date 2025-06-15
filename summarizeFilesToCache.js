
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
  const cachePath = path.resolve('./yran_brain.json');
  const existing = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : { documents: [] };
  const cachedMap = new Map(existing.documents.map(doc => [doc.id, doc.modifiedTime]));

  const documents = [...existing.documents];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (cachedMap.get(file.id) === file.modifiedTime) continue;

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
        modifiedTime: file.modifiedTime,
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

  fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf8');
  return documents;
}

module.exports = { summarizeFilesToCache };
