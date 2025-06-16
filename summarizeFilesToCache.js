const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function summarizeFilesToCache(files) {
  const summaries = [];
  let totalSize = 0;

  for (const file of files) {
    if (!file.name || !file.id || !file.mimeType) continue;

    const summary = {
      id: file.id,
      filename: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      size: parseInt(file.size || 0),
      summary: `📎 ${file.name} (${file.mimeType}) – ej analyserad (demo)`
    };

    totalSize += summary.size;
    summaries.push(summary);
  }

  const result = {
    lastUpdated: new Date().toISOString(),
    totalFiles: summaries.length,
    totalSize,
    documents: summaries
  };

  const filePath = path.resolve('./yran_brain.json');
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  return summaries;
}

module.exports = { summarizeFilesToCache };
