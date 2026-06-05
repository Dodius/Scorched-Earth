import { writeFileSync } from 'fs';

const apiUrl = process.env.SE_API_URL || process.env.VITE_API_URL || '';
const normalized = apiUrl.replace(/\/$/, '');

writeFileSync('config.js', `window.SE_API_URL = ${JSON.stringify(normalized)};\n`);
console.log(`[frontend] config.js written with SE_API_URL=${normalized || '(same origin)'}`);
