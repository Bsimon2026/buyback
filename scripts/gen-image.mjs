// Generate an image with the Gemini image models.
//
//   node scripts/gen-image.mjs --prompt-file shot.txt --out assets/x.png [--model gemini-3-pro-image]
//                              [--aspect 16:9] [--size 2K]
//
// The key is read from $GEMINI_API_KEY, or from ~/.keys/gemini.txt (never committed).
// Nothing here ever prints the key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const prompt = fs.readFileSync(args['prompt-file'], 'utf8').trim();
const out = path.resolve(args.out);
const model = args.model || 'gemini-3-pro-image';
const aspect = args.aspect || '16:9';
const size = args.size || '2K';

const key = process.env.GEMINI_API_KEY || fs.readFileSync(path.join(os.homedir(), '.keys', 'gemini.txt'), 'utf8').trim();
if (!key) throw new Error('No key: set GEMINI_API_KEY or write ~/.keys/gemini.txt');

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const t0 = Date.now();
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: size } },
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 400).split(key).join('<key>')}`);
  process.exit(1);
}
const data = JSON.parse(text);
const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData || p.inline_data);
const inline = part && (part.inlineData || part.inline_data);
if (!inline) {
  console.error('No image in response:', JSON.stringify(data).slice(0, 400));
  process.exit(1);
}
const buf = Buffer.from(inline.data, 'base64');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
const blocked = data.candidates?.[0]?.finishReason;
console.log(`${out}  ${inline.mimeType}  ${(buf.length / 1024).toFixed(0)} KB  ${((Date.now() - t0) / 1000).toFixed(1)}s${blocked ? '  finish=' + blocked : ''}`);
