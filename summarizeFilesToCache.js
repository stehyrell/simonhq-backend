const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

async function summarizeFilesToCache(files) {
  if (!Array.isArray(files) || files.length === 0) {
    console.warn('⚠️ Inga filer att sammanfatta.');
    return [];
  }

  console.log(`🧠 Startar sammanfattning av ${files.length} filer...`);

  const summaries = await Promise.all(
    files.map(async (file) => {
      const { id, name, mimeType, modifiedTime, size } = file;
      const extension = getFileExtension(name);
      let summary = '';

      try {
        if (extension === 'docx') {
          const buffer = fs.readFileSync(path.resolve('drive_files', `${id}.docx`));
          const result = await mammoth.extractRawText({ buffer });
          summary = result.value.trim().slice(0, 1000);
        } else if (extension === 'pdf') {
          const buffer = fs.readFileSync(path.resolve('drive_files', `${id}.pdf`));
          const result = await pdfParse(buffer);
          summary = result.text.trim().slice(0, 1000);
        } else {
          summary = '[Ej stödd filtyp]';
        }
      } catch (err) {
        console.error(`⚠️ Kunde inte sammanfatta ${name}:`, err.message);
        summary = '[Fel vid sammanfattning]';
      }

      return {
        id,
        filename: name,
        summary,
        modifiedTime,
        size: parseInt(size) || 0,
      };
    })
  );

  const totalSize = summaries.reduce((sum, f) => sum + (f.size || 0), 0);

  const cacheData = {
    lastUpdated: new Date().toISOString(),
    totalFiles: summaries.length,
    totalSize,
    totalSizeBytes: totalSize,
    documents: summaries,
  };

  fs.writeFileSync(path.resolve('./yran_brain.json'), JSON.stringify(cacheData, null, 2));
  console.log(`✅ Sammanfattning klar: ${summaries.length} filer sparade till cache.`);

  return summaries;
}

module.exports = { summarizeFilesToCache };
