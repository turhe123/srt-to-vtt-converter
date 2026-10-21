// subtitles.js — SRT and WebVTT decoding, parsing and serialization. Pure string work, no DOM.
// One pass over the lines, so files with tens of thousands of cues convert in milliseconds.

const TS = '(\\d+(?::\\d+){1,3}(?:[.,]\\d+)?)';
// Tolerant timing line: timestamp, an arrow (--> or a sloppy -> / --->), timestamp, optional settings.
const TIMING_RE = new RegExp(`^\\s*${TS}\\s*(-{1,3}>|→)\\s*${TS}(?:[ \\t]+(.*?))?\\s*$`);
const INT_RE = /^\s*\d+\s*$/;

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const MESSAGES = {
  decoded1252: () => 'The file is not valid UTF-8, so it was read as Windows-1252 (Western European)',
  noHeader: () => 'The WEBVTT header was missing',
  note: (n) => `Removed ${plural(n, 'NOTE block')}`,
  style: (n) => `Removed ${plural(n, 'STYLE block')}`,
  region: (n) => `Removed ${plural(n, 'REGION block')}`,
  settings: (n) => `Removed cue settings such as position or align from ${plural(n, 'cue')}`,
  coords: (n) => `Removed SRT X1/Y1 screen coordinates from ${plural(n, 'cue')}`,
  noIndex: (n) => `${plural(n, 'cue')} had no index number`,
  missingBlank: (n) => `${plural(n, 'cue')} had no blank line before the next cue`,
  joinedBlank: (n) => `Removed blank lines inside ${plural(n, 'cue')}`,
  orphan: (n) => `Dropped ${plural(n, 'text block')} without a timing line`,
  junk: (n) => `Ignored ${plural(n, 'stray line')} before a timing line`,
  arrow: (n) => `Fixed the arrow in ${plural(n, 'timing line')}`,
  noHours: (n) => `Added zero hours to ${plural(n, 'timestamp')}`,
  shortMs: (n) => `Padded milliseconds to three digits in ${plural(n, 'timestamp')}`,
  longMs: (n) => `Cut milliseconds to three digits in ${plural(n, 'timestamp')}`,
  noMs: (n) => `Added missing milliseconds to ${plural(n, 'timestamp')}`,
  sepDot: (n) => `Fixed ${plural(n, 'timestamp')} that used a dot instead of a comma`,
  sepComma: (n) => `Fixed ${plural(n, 'timestamp')} that used a comma instead of a dot`,
  colonMs: (n) => `Fixed ${plural(n, 'timestamp')} that used a colon before the milliseconds`,
  range: (n) => `Normalized ${plural(n, 'timestamp')} with minutes or seconds above 59`,
  badTime: (n) => `Dropped ${plural(n, 'cue')} with an unreadable timestamp`,
  empty: (n) => `Dropped ${plural(n, 'empty cue')}`,
  endBeforeStart: (n) => `${plural(n, 'cue ends', 'cues end')} before starting; players may skip them`,
  overlap: (n) => `${plural(n, 'cue overlaps', 'cues overlap')} the previous cue`,
  order: (n) => `${plural(n, 'cue starts', 'cues start')} before the previous cue (out of order)`,
  arrowText: (n) => `Escaped "-->" inside the text of ${plural(n, 'cue')} because WebVTT does not allow it`,
  fontTags: (n) => `Removed <font> tags from ${plural(n, 'cue')}, which WebVTT does not support`,
  assTags: (n) => `Removed {\\an8}-style position codes from ${plural(n, 'cue')}`,
  vttTags: (n) => `Removed WebVTT-only tags (voice, class, ruby, karaoke timing) from ${plural(n, 'cue')}`,
};

function makeReport() {
  const map = new Map();
  return {
    add(key, cue) {
      let e = map.get(key);
      if (!e) { e = { count: 0, cues: [], more: false }; map.set(key, e); }
      e.count++;
      if (cue == null || e.cues[e.cues.length - 1] === cue) return;
      if (e.cues.length < 5) e.cues.push(cue);
      else e.more = true;
    },
    list() {
      return [...map].map(([key, e]) => {
        const where = e.cues.length ? ` (${e.cues.join(', ')}${e.more ? ', …' : ''})` : '';
        return { key, count: e.count, text: MESSAGES[key](e.count) + where };
      });
    },
  };
}

/* ---------- Decoding ---------- */

const MAGIC = [
  [[0x89, 0x50, 0x4e, 0x47], 'a PNG image'], [[0xff, 0xd8, 0xff], 'a JPEG image'], [[0x47, 0x49, 0x46, 0x38], 'a GIF image'],
  [[0x25, 0x50, 0x44, 0x46], 'a PDF document'], [[0x50, 0x4b, 0x03, 0x04], 'a ZIP archive'], [[0x52, 0x49, 0x46, 0x46], 'a RIFF media file'],
  [[0x1a, 0x45, 0xdf, 0xa3], 'a Matroska/WebM video'], [[0x49, 0x44, 0x33], 'an MP3 file'], [[0x4f, 0x67, 0x67, 0x53], 'an Ogg file'],
];

export class NotTextError extends Error {}

/** Decode bytes: UTF-8 (BOM removed), UTF-16 by BOM or NUL pattern, Windows-1252 fallback. Throws NotTextError for binary. */
export function decodeBytes(bytes) {
  const b = bytes;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8 with BOM', repaired: false };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16 LE', repaired: false };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16 BE', repaired: false };
  for (const [sig, what] of MAGIC) if (sig.every((v, i) => b[i] === v)) throw new NotTextError(`This is not a text file: it looks like ${what}. Choose an .srt or .vtt subtitle file.`);
  const n = Math.min(b.length, 8192);
  let evenNul = 0, oddNul = 0, ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) { if (i & 1) oddNul++; else evenNul++; }
    else if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  const half = n / 2;
  if (oddNul > half * 0.3 && evenNul === 0) return { text: new TextDecoder('utf-16le').decode(b), encoding: 'UTF-16 LE', repaired: false };
  if (evenNul > half * 0.3 && oddNul === 0) return { text: new TextDecoder('utf-16be').decode(b), encoding: 'UTF-16 BE', repaired: false };
  if (evenNul + oddNul > 0 || ctrl > n * 0.02) throw new NotTextError('This is not a text file (it contains binary data). Choose an .srt or .vtt subtitle file.');
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8', repaired: false };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252', repaired: true };
  }
}

/* ---------- Detection ---------- */

/** 'vtt' | 'srt' | null, from content first and the file name only as a tie-breaker. */
export function detectFormat(text, name = '') {
  const t = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT(?:[ \t\n]|$)/.test(t)) return 'vtt';
  const m = t.match(/(\d+(?::\d+){1,3}([.,])\d+)[ \t]*-{1,3}>/);
  if (!m) return null;
  if (m[2] === ',') return 'srt';
  if (/(?:^|\n)[ \t]*\d+[ \t]*\n[^\n]*-->/.test(t)) return 'srt';
  if (/\.srt$/i.test(name)) return 'srt';
  return 'vtt';
}

/* ---------- Parsing ---------- */

function parseTime(raw, fmt, flags) {
  const sepMatch = raw.match(/[.,]/);
  const [clock, frac] = sepMatch ? [raw.slice(0, sepMatch.index), raw.slice(sepMatch.index + 1)] : [raw, undefined];
  const parts = clock.split(':').map(Number);
  let h = 0, m, s, ms = 0;
  if (parts.length === 4) {
    if (frac !== undefined) return NaN;
    [h, m, s] = parts;
    ms = Number(String(parts[3]).padEnd(3, '0').slice(0, 3));
    flags.push('colonMs');
  } else if (parts.length === 3) {
    [h, m, s] = parts;
  } else {
    [m, s] = parts;
    flags.push('noHours');
  }
  if (frac !== undefined) {
    if (fmt === 'srt' && sepMatch[0] === '.') flags.push('sepDot');
    if (fmt === 'vtt' && sepMatch[0] === ',') flags.push('sepComma');
    if (frac.length < 3) flags.push('shortMs');
    if (frac.length > 3) flags.push('longMs');
    ms = Number(frac.padEnd(3, '0').slice(0, 3));
  } else if (parts.length !== 4) {
    flags.push('noMs');
  }
  if (m > 59 || s > 59) flags.push('range');
  return ((h * 60 + m) * 60 + s) * 1000 + ms;
}

/**
 * Parse SRT or VTT text into cues: { id, start, end, settings, lines }.
 * Line based state machine: blank lines end blocks, a line with an arrow between two timestamps starts a cue.
 */
export function parse(input, fmt, report = makeReport()) {
  const lines = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let i = 0;
  if (fmt === 'vtt') {
    if (/^WEBVTT(?:[ \t]|$)/.test(lines[0])) { while (i < lines.length && lines[i].trim() !== '') i++; }
    else report.add('noHeader');
  }

  let cur = null;        // cue being filled
  let sawBlank = true;   // a blank line came after the current cue's text
  let pending = [];      // lines after a blank that are not a cue yet (id candidates or stray text)
  let skipping = false;  // inside a NOTE / STYLE / REGION block

  const label = () => `cue ${cues.length + 1}`;
  const at = () => `line ${i + 1}`;
  const finish = () => {
    if (!cur) return;
    const c = cur;
    cur = null;
    while (c.lines.length && c.lines[c.lines.length - 1].trim() === '') c.lines.pop();
    if (!c.lines.length) { report.add('empty', `line ${c.line}`); return; }
    const prev = cues[cues.length - 1];
    const no = label();
    if (c.end < c.start) report.add('endBeforeStart', no);
    if (prev) {
      if (c.start < prev.start) report.add('order', no);
      else if (c.start < prev.end) report.add('overlap', no);
    }
    cues.push(c);
  };
  const resolvePending = () => {
    if (!pending.length) return;
    if (pending.length === 1 && INT_RE.test(pending[0])) return; // an index separated from its timing by a blank line
    if (fmt === 'srt' && cur) { report.add('joinedBlank', at()); cur.lines.push(...pending); }
    else report.add('orphan', at());
    pending = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      skipping = false;
      if (cur) sawBlank = true;
      resolvePending();
      continue;
    }
    if (skipping) continue;
    const m = TIMING_RE.exec(line);
    if (m) {
      let id = '';
      if (cur && !sawBlank && fmt === 'srt' && cur.lines.length && INT_RE.test(cur.lines[cur.lines.length - 1])) {
        id = cur.lines.pop().trim();
        report.add('missingBlank', at());
      } else if (cur && !sawBlank) {
        report.add('missingBlank', at());
      }
      if (pending.length) {
        id = pending.pop().trim();
        if (pending.length) {
          if (fmt === 'srt' && cur) { report.add('joinedBlank', at()); cur.lines.push(...pending); }
          else for (let k = 0; k < pending.length; k++) report.add('junk', at());
          pending = [];
        }
      }
      finish();
      const flags = [];
      const start = parseTime(m[1], fmt, flags);
      const end = parseTime(m[3], fmt, flags);
      const no = at();
      for (const f of flags) report.add(f, no);
      if (m[2] !== '-->') report.add('arrow', no);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        report.add('badTime', no);
        cur = null;
        sawBlank = false;
        // swallow the text of the broken cue
        while (i + 1 < lines.length && lines[i + 1].trim() !== '') i++;
        continue;
      }
      if (fmt === 'srt' && !INT_RE.test(id)) report.add('noIndex', no);
      cur = { id, start, end, settings: (m[4] || '').trim(), lines: [], line: i + 1 };
      sawBlank = false;
      continue;
    }
    if (cur && !sawBlank) { cur.lines.push(line.replace(/\s+$/, '')); continue; }
    if (fmt === 'vtt' && !pending.length) {
      const kw = /^(NOTE|STYLE|REGION)(?:[ \t]|$)/.exec(line);
      if (kw) { report.add(kw[1].toLowerCase()); skipping = true; continue; }
    }
    pending.push(line.replace(/\s+$/, ''));
  }
  resolvePending();
  finish();
  return cues;
}

/* ---------- Serialization ---------- */

const pad = (n, w) => String(n).padStart(w, '0');
export function formatTime(ms, sep) {
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms % 1000, 3)}`;
}

function textForVtt(lines, from, no, report) {
  let t = lines.join('\n');
  if (from === 'srt') {
    if (/<\/?font\b/i.test(t)) { t = t.replace(/<\/?font\b[^>]*>/gi, ''); report.add('fontTags', no); }
    if (/\{\\[^}]*\}/.test(t)) { t = t.replace(/\{\\[^}]*\}/g, ''); report.add('assTags', no); }
    t = t.replace(/<(\/?)([BIU])>/g, (_, s, tag) => `<${s}${tag.toLowerCase()}>`)
      .replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
      .replace(/<(?![/a-zA-Z0-9])/g, '&lt;');
  }
  if (t.includes('-->')) { t = t.replaceAll('-->', '--&gt;'); report.add('arrowText', no); }
  return t;
}

function textForSrt(lines, from, no, report) {
  let t = lines.join('\n');
  if (from === 'vtt') {
    const stripped = t.replace(/<\/?(?:c|v|lang|ruby|rt)(?:[.\s][^>]*)?>|<\d[\d:.]*>/g, '');
    if (stripped !== t) report.add('vttTags', no);
    t = stripped.replace(/<(\/?)([biu])\.[^>\s]*>/g, '<$1$2>')
      .replace(/&gt;/g, '>').replace(/&nbsp;/g, '\u00A0').replace(/&lrm;/g, '\u200E').replace(/&rlm;/g, '\u200F').replace(/&amp;/g, '&');
  }
  return t;
}

/** Serialize cues to the target format. */
export function serialize(cues, target, from, { keepIds = false, crlf = false } = {}, report = makeReport()) {
  const out = [];
  if (target === 'vtt') {
    out.push('WEBVTT', '');
    for (let k = 0; k < cues.length; k++) {
      const c = cues[k], no = `cue ${k + 1}`;
      if (from === 'vtt' && c.id) out.push(c.id);
      else if (from === 'srt' && keepIds) out.push(String(k + 1));
      let settings = '';
      if (c.settings) {
        if (from === 'srt') report.add('coords', no);
        else settings = ' ' + c.settings;
      }
      out.push(`${formatTime(c.start, '.')} --> ${formatTime(c.end, '.')}${settings}`, textForVtt(c.lines, from, no, report), '');
    }
    return out.join('\n');
  }
  for (let k = 0; k < cues.length; k++) {
    const c = cues[k], no = `cue ${k + 1}`;
    if (c.settings && from === 'vtt') report.add('settings', no);
    else if (c.settings) report.add('coords', no);
    out.push(String(k + 1), `${formatTime(c.start, ',')} --> ${formatTime(c.end, ',')}`, textForSrt(c.lines, from, no, report), '');
  }
  const s = out.join('\n');
  return crlf ? s.replace(/\n/g, '\r\n') : s;
}

/**
 * Convert decoded text. target: 'auto' | 'vtt' | 'srt'. Returns
 * { from, to, cues, output, warnings: [{ key, count, text }] }; throws if no cues are found.
 */
export function convert(text, { target = 'auto', name = '', keepIds = false, crlf = false, decodedAs1252 = false } = {}) {
  const from = detectFormat(text, name);
  if (!from) throw new Error('No subtitle timings found. An SRT or VTT file needs lines like "00:00:01,000 --> 00:00:03,000".');
  const to = target === 'auto' ? (from === 'srt' ? 'vtt' : 'srt') : target;
  const report = makeReport();
  if (decodedAs1252) report.add('decoded1252');
  const cues = parse(text, from, report);
  if (!cues.length) throw new Error('No cues with text were found in this file.');
  const output = serialize(cues, to, from, { keepIds, crlf }, report);
  return { from, to, cues: cues.length, output, warnings: report.list() };
}

export function outputName(name, to) {
  const base = name.replace(/\.(srt|vtt|txt|sub)$/i, '');
  return `${base || 'subtitles'}.${to}`;
}
