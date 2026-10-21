// app.js — SRT ⇄ WebVTT converter UI (ES module). Everything runs on this device; nothing is uploaded.
// The conversion itself is plain string work in subtitles.js (single pass, fast enough without a worker).
import { toast, downloadBlob, formatBytes, wireDropzone } from './site.js';
import { decodeBytes, convert, outputName, NotTextError } from './subtitles.js';

const MAX_BYTES = 100 * 1024 * 1024;
const PREVIEW_LINES = 14;
const FORMAT_NAME = { srt: 'SRT', vtt: 'WebVTT' };

const zone = document.getElementById('dropzone');
const input = document.getElementById('file-input');
const paste = document.getElementById('paste-input');
const pasteBtn = document.getElementById('convert-paste');
const options = document.getElementById('options');
const keepIds = document.getElementById('keep-ids');
const crlf = document.getElementById('crlf');
const progress = document.getElementById('progress');
const progressBar = progress.querySelector('.progress');
const progressText = document.getElementById('progress-text');
const results = document.getElementById('results');

// Each source: { name, size, text, encoding, decodedAs1252, error }. Kept so option changes re-convert instantly.
let sources = [];
let urls = [];

const settings = () => ({
  target: options.querySelector('input[name="target"]:checked').value,
  keepIds: keepIds.checked,
  crlf: crlf.checked,
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setProgress(done, total) {
  // Floor, so the bar never claims 100% before the last file is done.
  const pct = total ? Math.floor((done / total) * 100) : 0;
  progressBar.firstElementChild.style.width = `${pct}%`;
  progressBar.setAttribute('aria-valuenow', String(pct));
  progressText.textContent = `Reading file ${Math.min(done + 1, total)} of ${total} (${pct}%)`;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function readFile(file) {
  const src = { name: file.name, size: file.size };
  try {
    if (file.size > MAX_BYTES) throw new NotTextError(`This file is ${formatBytes(file.size)}. Subtitle files are rarely over a few megabytes; the limit here is ${formatBytes(MAX_BYTES)}.`);
    const { text, encoding, repaired } = decodeBytes(new Uint8Array(await file.arrayBuffer()));
    Object.assign(src, { text, encoding, decodedAs1252: repaired });
  } catch (err) {
    src.error = err instanceof NotTextError ? err.message : `Could not read this file: ${err.message}`;
  }
  return src;
}

async function handleFiles(files) {
  if (!files.length) return;
  progress.hidden = false;
  const loaded = [];
  for (let i = 0; i < files.length; i++) {
    setProgress(i, files.length);
    loaded.push(await readFile(files[i]));
    if (files.length > 1) await nextFrame();
  }
  progress.hidden = true;
  sources = loaded;
  render(true);
}

function handlePaste() {
  const text = paste.value;
  if (!text.trim()) {
    sources = [{ name: 'Pasted text', size: 0, error: 'The paste box is empty. Paste SRT or WebVTT text first.' }];
  } else {
    sources = [{ name: 'pasted-subtitles', size: new Blob([text]).size, text, encoding: 'pasted text', pasted: true }];
  }
  render(true);
}

function revokeAll() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
}

function renderError(card, message) {
  const alert = el('p', 'alert alert--error sv-error', message);
  alert.setAttribute('role', 'alert');
  card.append(alert);
}

function renderCard(src, opts) {
  const card = el('article', 'result sv-card');
  const head = el('div', 'sv-card__head');
  const meta = el('div', 'result__meta');
  const title = el('h3', 'result__name', src.pasted ? 'Pasted text' : src.name);
  title.title = title.textContent;
  const info = el('p', 'result__info sv-info');
  meta.append(title, info);
  head.append(meta);
  card.append(head);

  if (src.error) {
    card.classList.add('sv-card--error');
    info.textContent = src.size ? formatBytes(src.size) : '';
    renderError(card, src.error);
    return { card, output: null };
  }

  let res;
  try {
    res = convert(src.text, { ...opts, name: src.name, decodedAs1252: src.decodedAs1252 });
  } catch (err) {
    card.classList.add('sv-card--error');
    info.textContent = `${formatBytes(src.size)} · ${src.encoding}`;
    renderError(card, err.message);
    return { card, output: null };
  }

  const name = outputName(src.name, res.to);
  const blob = new Blob([res.output], { type: res.to === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  urls.push(url);

  const fmt = el('span', 'chip sv-format', `${FORMAT_NAME[res.from]} → ${FORMAT_NAME[res.to]}`);
  const cues = el('span', 'stat sv-cues', `${res.cues.toLocaleString()} ${res.cues === 1 ? 'cue' : 'cues'}`);
  info.append(fmt, ' ', cues, ` · ${formatBytes(src.size)} · ${src.encoding}`);
  card.dataset.from = res.from;
  card.dataset.to = res.to;

  const actions = el('div', 'row sv-card__actions');
  const link = el('a', 'btn btn--primary btn--small sv-download', `Download ${name}`);
  link.href = url;
  link.download = name;
  const copy = el('button', 'btn btn--small sv-copy', 'Copy text');
  copy.type = 'button';
  copy.setAttribute('aria-label', `Copy ${name} text`);
  copy.addEventListener('click', () => copyText(res.output, name));
  actions.append(link, copy);
  head.append(actions);

  const warnBox = el('div', 'sv-warnings');
  if (res.warnings.length) {
    warnBox.append(el('p', 'sv-warnings__title stat--warn', `${res.warnings.length} ${res.warnings.length === 1 ? 'warning' : 'warnings'}`));
    const list = el('ul', 'sv-warnings__list');
    for (const w of res.warnings) {
      const li = el('li', null, w.text);
      li.dataset.key = w.key;
      list.append(li);
    }
    warnBox.append(list);
  } else {
    warnBox.append(el('p', 'sv-warnings__title stat--ok', 'No warnings: nothing was repaired or dropped.'));
  }
  card.append(warnBox);

  const lines = res.output.split(/\r?\n/);
  const pre = el('pre', 'code sv-preview', lines.slice(0, PREVIEW_LINES).join('\n') + (lines.length > PREVIEW_LINES ? '\n…' : ''));
  pre.dir = 'auto';
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', `Preview of the first lines of ${name}`);
  card.append(pre);

  return { card, output: { name, blob } };
}

function render(scroll = false) {
  revokeAll();
  results.replaceChildren();
  if (!sources.length) return;
  const opts = settings();
  const rendered = sources.map((s) => renderCard(s, opts));
  const outputs = rendered.map((r) => r.output).filter(Boolean);
  const failed = rendered.length - outputs.length;

  const bar = el('div', 'row row--between sv-summary');
  const parts = [`${outputs.length} of ${rendered.length} ${rendered.length === 1 ? 'file' : 'files'} converted`];
  if (failed) parts.push(`${failed} could not be read`);
  bar.append(el('p', 'sv-summary__text', parts.join(' · ')));
  const actions = el('div', 'row');
  if (outputs.length > 1) {
    const all = el('button', 'btn btn--primary', `Download all (${outputs.length})`);
    all.type = 'button';
    all.id = 'download-all';
    all.addEventListener('click', () => downloadAll(outputs, all));
    actions.append(all);
  }
  const clear = el('button', 'btn btn--ghost', 'Clear');
  clear.type = 'button';
  clear.id = 'clear';
  clear.addEventListener('click', () => { sources = []; render(); zone.focus(); });
  actions.append(clear);
  bar.append(actions);

  results.append(bar, ...rendered.map((r) => r.card));
  if (scroll) rendered[0].card.scrollIntoView({ block: 'nearest' });
}

async function downloadAll(outputs, button) {
  button.disabled = true;
  for (let i = 0; i < outputs.length; i++) {
    button.textContent = `Saving ${i + 1} of ${outputs.length}…`;
    downloadBlob(outputs[i].blob, outputs[i].name);
    // A short gap between files: browsers block bursts of simultaneous downloads.
    await new Promise((r) => setTimeout(r, 350));
  }
  button.textContent = `Download all (${outputs.length})`;
  button.disabled = false;
  toast(`${outputs.length} files saved, each as its own file`);
}

async function copyText(text, name) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${name} to the clipboard`);
  } catch {
    const ta = el('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? `Copied ${name} to the clipboard` : 'Copy is blocked here; use the Download button instead');
  }
}

wireDropzone(zone, input, handleFiles);

pasteBtn.addEventListener('click', handlePaste);
// The browser handles Ctrl/⌘+V in the focused box; convert as soon as the pasted text lands.
paste.addEventListener('paste', () => setTimeout(handlePaste, 0));
paste.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handlePaste(); }
});
// Enter on an option converts again (radios and checkboxes already re-convert on change).
options.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input')) {
    e.preventDefault();
    if (!sources.length && paste.value.trim()) handlePaste();
    else render(true);
  }
});
options.addEventListener('change', () => render());

// Called by the factory's screenshot script to show the tool in a realistic, fictional state.
window.__demo = async () => {
  const names = ['harbor-lights.srt', 'harbor-lights.vtt'];
  const files = await Promise.all(names.map(async (n) => {
    const res = await fetch(`./tests/fixtures/${n}`);
    return new File([await res.arrayBuffer()], n, { type: 'text/plain' });
  }));
  await handleFiles(files);
};

export { handleFiles, handlePaste };
