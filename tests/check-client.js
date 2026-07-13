const fs = require('fs');

const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);

if (!scripts.length) throw new Error('index.html contains no inline scripts');
for (const [index, source] of scripts.entries()) {
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`inline script ${index + 1} does not compile: ${error.message}`);
  }
}

console.log(`client check passed (${scripts.length} inline scripts)`);
