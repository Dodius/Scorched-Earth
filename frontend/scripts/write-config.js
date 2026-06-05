import { writeFileSync } from 'fs';

const apiUrl = process.env.API_URL || process.env.VITE_API_URL || process.env.SE_API_URL || '';
const normalized = apiUrl.replace(/\/$/, '');

writeFileSync(
  'config.js',
  `window.API_URL = ${JSON.stringify(normalized)};\nwindow.VITE_API_URL = ${JSON.stringify(normalized)};\nwindow.SE_API_URL = ${JSON.stringify(normalized)};\n`
);
console.log(`[frontend] config.js written with API_URL=${normalized || '(same origin)'}`);
