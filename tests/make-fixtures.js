// make-fixtures.js — writes the small, fictional subtitle fixtures used by __demo and smoke.spec.js.
// Run with: node tests/make-fixtures.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'fixtures');
const write = (name, data) => fs.writeFileSync(path.join(dir, name), data);

// "Harbor Lights Trailer": six cues of fictional dialogue.
const cues = [
  ['00:00:01,200', '00:00:04,000', ['The fog rolled in the night', 'the lighthouse went dark.']],
  ['00:00:04,800', '00:00:07,300', ['<i>Somebody switched it off.</i>']],
  ['00:00:08,000', '00:00:10,500', ['Keeper, the boats are still out there!']],
  ['00:00:11,100', '00:00:13,900', ['Then we light the harbor', 'ourselves. Every lamp we have.']],
  ['00:00:14,600', '00:00:17,000', ['One town. One night.']],
  ['00:00:18,000', '00:00:21,500', ['HARBOR LIGHTS', 'Coming soon.']],
];

// SRT: Windows line endings and a UTF-8 byte order mark, like many desktop tools write.
const srt = cues.map(([a, b, lines], i) => `${i + 1}\r\n${a} --> ${b}\r\n${lines.join('\r\n')}\r\n`).join('\r\n');
write('harbor-lights.srt', '\uFEFF' + srt);

// VTT: header, a NOTE block, a STYLE block, a position setting and one timestamp without hours.
const vtt = [
  'WEBVTT - Harbor Lights Trailer',
  '',
  'NOTE Fictional trailer used for the demo.',
  'All names and lines are made up.',
  '',
  'STYLE',
  '::cue { color: #ffd479; }',
  '',
  'intro',
  '00:01.200 --> 00:00:04.000 position:10% align:start',
  'The fog rolled in the night',
  'the lighthouse went dark.',
  '',
  '00:00:04.800 --> 00:00:07.300',
  '<i>Somebody switched it off.</i>',
  '',
  '00:00:08.000 --> 00:00:10.500 line:85%',
  '<v Mara>Keeper, the boats are still out there!',
  '',
  '00:00:11.100 --> 00:00:13.900',
  'Then we light the harbor',
  'ourselves. Every lamp we have.',
  '',
  '00:00:14.600 --> 00:00:17.000',
  'One town. One night.',
  '',
  '00:00:18.000 --> 00:00:21.500 align:center',
  'HARBOR LIGHTS',
  'Coming soon.',
  '',
].join('\n');
write('harbor-lights.vtt', vtt);

// Edge cases: missing index, dot separator, extra blank lines, overlap, empty cue, arrow in text,
// two-digit milliseconds, emoji, right-to-left text, and old Mac (CR only) line endings.
const edge = [
  '1',
  '00:00:01,000 --> 00:00:03,000',
  'First line 🎬',
  '',
  '',
  '',
  '00:00:02.500 --> 00:00:05,000',
  'No index and it overlaps',
  '',
  '3',
  '00:00:06,00 --> 00:00:07,000',
  '',
  '4',
  '00:00:08,000 --> 00:00:09,500',
  'Arrow --> inside the text',
  '',
  '5',
  '00:00:10,000 --> 00:00:12,000',
  'مرحبا بكم في الميناء',
  '',
].join('\r');
write('edge-cases.srt', edge);

// UTF-16 LE with a byte order mark.
const utf16 = Buffer.from('\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nCafé au lait ☕\r\n', 'utf16le');
write('utf16.srt', utf16);

// A plain .txt that actually holds WebVTT (format must come from content, not the extension).
write('captions.txt', 'WEBVTT\n\n00:05.000 --> 00:07.000\nDetected from content.\n');

console.log('fixtures written to', dir);
