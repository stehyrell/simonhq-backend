
const fs = require('fs');
const path = require('path');

function updateProgress({ total, completed, lastFile, downloadedBytes, currentPage }) {
  const progressPath = path.resolve('./drive_progress.json');
  const previous = fs.existsSync(progressPath)
    ? JSON.parse(fs.readFileSync(progressPath, 'utf8'))
    : {};

  const progress = {
    total,
    completed,
    lastFile,
    downloadedBytes,
    currentPage,
    startedAt: previous.startedAt || new Date().toISOString()
  };

  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');
}

function getProgress() {
  const progressPath = path.resolve('./drive_progress.json');
  if (!fs.existsSync(progressPath)) return null;
  return JSON.parse(fs.readFileSync(progressPath, 'utf8'));
}

module.exports = { updateProgress, getProgress };
