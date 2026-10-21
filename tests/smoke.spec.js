// smoke.spec.js — SRT ⇄ WebVTT converter checks on bundled fictional fixtures (see tests/make-fixtures.js).
// Every acceptance check in SPEC.md is covered here. Self-contained (Playwright only).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
const readDownload = async (download) => fs.readFileSync(await download.path(), 'utf8');

// Drop real files on the drop zone the way a browser does: a DataTransfer carried by a drop event.
async function dropFiles(page, names) {
  const files = names.map((n) => ({ name: n, b64: fs.readFileSync(fixture(n)).toString('base64') }));
  const dt = await page.evaluateHandle((list) => {
    const data = new DataTransfer();
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], f.name));
    }
    return data;
  }, files);
  await page.dispatchEvent('#dropzone', 'dragenter', { dataTransfer: dt });
  await page.dispatchEvent('#dropzone', 'drop', { dataTransfer: dt });
}

test.describe('SRT to VTT Subtitle Converter', () => {
  test('sample.srt converted to VTT starts with WEBVTT and uses dots, and downloads as .vtt', async ({ page }) => {
    await page.goto('./');
    await page.click('label[for="target-vtt"]');
    await page.setInputFiles('#file-input', fixture('sample.srt'));
    const card = page.locator('.sv-card');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.sv-format')).toHaveText('SRT → WebVTT');
    await expect(card.locator('.sv-preview')).toContainText('00:00:01.000 --> 00:00:03.500');

    const [download] = await Promise.all([page.waitForEvent('download'), card.locator('.sv-download').click()]);
    expect(download.suggestedFilename()).toBe('sample.vtt');
    const text = await readDownload(download);
    expect(text.startsWith('WEBVTT\n\n')).toBe(true);
    expect(text).toContain('00:00:07.250 --> 00:00:09.000\nGoodbye!');
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2},\d{3}/);
    expect(text).not.toMatch(/^\d+\n\d{2}:/m); // SRT indexes are dropped by default
  });

  test('sample.vtt converted to SRT has numbered cues with commas, and downloads as .srt', async ({ page }) => {
    await page.goto('./');
    await page.click('label[for="target-srt"]');
    await page.setInputFiles('#file-input', fixture('sample.vtt'));
    const card = page.locator('.sv-card');
    await expect(card.locator('.sv-format')).toHaveText('WebVTT → SRT');
    const [download] = await Promise.all([page.waitForEvent('download'), card.locator('.sv-download').click()]);
    expect(download.suggestedFilename()).toBe('sample.srt');
    const text = await readDownload(download);
    expect(text).toBe('1\n00:00:01,000 --> 00:00:03,500\nHello and welcome.\n\n2\n00:00:04,000 --> 00:00:06,000\nThis is a sample subtitle file.\n');
    expect(text).not.toContain('WEBVTT');
  });

  test('VTT to SRT drops NOTE/STYLE and cue settings, adds hours, and can use CRLF', async ({ page }) => {
    await page.goto('./');
    await page.check('#crlf');
    await page.setInputFiles('#file-input', fixture('harbor-lights.vtt'));
    const card = page.locator('.sv-card');
    await expect(card.locator('.sv-format')).toHaveText('WebVTT → SRT'); // Auto = opposite of detected
    const [download] = await Promise.all([page.waitForEvent('download'), card.locator('.sv-download').click()]);
    const text = await readDownload(download);
    expect(text.startsWith('1\r\n00:00:01,200 --> 00:00:04,000\r\nThe fog rolled in the night\r\n')).toBe(true);
    expect(text).not.toMatch(/NOTE|STYLE|position:|align:|<v /);
    expect(text).toContain('6\r\n00:00:18,000 --> 00:00:21,500\r\nHARBOR LIGHTS\r\nComing soon.');
    expect(text).not.toMatch(/[^\r]\n/);
  });

  test('dropping three files gives three results and a ZIP-free list of download links', async ({ page }) => {
    await page.goto('./');
    await dropFiles(page, ['sample.srt', 'harbor-lights.vtt', 'captions.txt']);
    await expect(page.locator('.sv-card')).toHaveCount(3);
    const links = page.locator('#results a.sv-download');
    await expect(links).toHaveCount(3);
    const names = await links.evaluateAll((as) => as.map((a) => a.getAttribute('download')));
    expect(names).toEqual(['sample.vtt', 'harbor-lights.srt', 'captions.srt']);
    for (const href of await links.evaluateAll((as) => as.map((a) => a.href))) expect(href).toMatch(/^blob:/);
    expect(names.some((n) => /\.zip$/i.test(n))).toBe(false);
    await expect(page.locator('.sv-summary')).toContainText('3 of 3 files converted');

    // Download all saves each file separately, in sequence.
    const seen = [];
    page.on('download', (d) => seen.push(d));
    await page.click('#download-all');
    await expect.poll(() => seen.length, { timeout: 10_000 }).toBe(3);
    expect(seen.map((d) => d.suggestedFilename())).toEqual(names);
    const sizes = await Promise.all(seen.map(async (d) => fs.statSync(await d.path()).size));
    for (const s of sizes) expect(s).toBeGreaterThan(40);
  });

  test('shows the cue count and a warning list after conversion', async ({ page }) => {
    await page.goto('./');
    await page.setInputFiles('#file-input', [fixture('harbor-lights.vtt'), fixture('edge-cases.srt'), fixture('harbor-lights.srt')]);
    const cards = page.locator('.sv-card');
    await expect(cards).toHaveCount(3);

    const vtt = cards.nth(0);
    await expect(vtt.locator('.sv-cues')).toHaveText('6 cues');
    await expect(vtt.locator('.sv-warnings__list li[data-key="note"]')).toHaveText('Removed 1 NOTE block');
    await expect(vtt.locator('.sv-warnings__list li[data-key="settings"]')).toContainText('3 cues');
    await expect(vtt.locator('.sv-warnings__list li[data-key="noHours"]')).toBeVisible();

    const edge = cards.nth(1);
    await expect(edge.locator('.sv-cues')).toHaveText('4 cues');
    for (const key of ['overlap', 'empty', 'noIndex', 'sepDot', 'shortMs', 'arrowText']) {
      await expect(edge.locator(`.sv-warnings__list li[data-key="${key}"]`)).toHaveCount(1);
    }
    await expect(edge.locator('.sv-preview')).toContainText('Arrow --&gt; inside the text');
    await expect(edge.locator('.sv-preview')).toContainText('First line 🎬');
    await expect(edge.locator('.sv-preview')).toContainText('مرحبا بكم في الميناء');

    const clean = cards.nth(2);
    await expect(clean.locator('.sv-cues')).toHaveText('6 cues');
    await expect(clean.locator('.sv-info')).toContainText('UTF-8 with BOM');
    await expect(clean.locator('.sv-warnings')).toContainText('No warnings');
  });

  test('a binary file shows an error on its card, also when mixed with valid files', async ({ page }) => {
    await page.goto('./');
    await page.setInputFiles('#file-input', [fixture('sample.png'), fixture('sample.srt')]);
    const cards = page.locator('.sv-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.alert.alert--error')).toContainText('not a text file');
    await expect(cards.nth(0).locator('.sv-download')).toHaveCount(0);
    await expect(cards.nth(1).locator('.sv-download')).toHaveText('Download sample.vtt');
    await expect(page.locator('.sv-summary')).toContainText('1 could not be read');

    await page.setInputFiles('#file-input', fixture('sample.zip'));
    await expect(page.locator('#results .alert--error')).toContainText('ZIP archive');
    await page.setInputFiles('#file-input', fixture('sample.json'));
    await expect(page.locator('#results .alert--error')).toContainText('No subtitle timings found');
  });

  test('pasted text converts, Ctrl+Enter reconverts and the target switch updates the result', async ({ page }) => {
    await page.goto('./');
    await page.fill('#paste-input', '1\n00:00:02,500 --> 00:00:04,000\nPasted <b>line</b>\nsecond line\n');
    await page.focus('#paste-input');
    await page.keyboard.press('Control+Enter');
    const card = page.locator('.sv-card');
    await expect(card.locator('.sv-preview')).toContainText('WEBVTT');
    await expect(card.locator('.sv-download')).toHaveText('Download pasted-subtitles.vtt');
    await expect(card.locator('.sv-preview')).toContainText('Pasted <b>line</b>\nsecond line');

    await page.check('#keep-ids');
    await expect(card.locator('.sv-preview')).toContainText('WEBVTT\n\n1\n00:00:02.500');
    await page.click('label[for="target-srt"]');
    await expect(page.locator('.sv-card .sv-download')).toHaveText('Download pasted-subtitles.srt');
  });

  test('decodes UTF-16 and detects format from content, not the extension', async ({ page }) => {
    await page.goto('./');
    await page.setInputFiles('#file-input', [fixture('utf16.srt'), fixture('captions.txt')]);
    const cards = page.locator('.sv-card');
    await expect(cards.nth(0).locator('.sv-info')).toContainText('UTF-16 LE');
    await expect(cards.nth(0).locator('.sv-preview')).toContainText('Café au lait ☕');
    await expect(cards.nth(1).locator('.sv-format')).toHaveText('WebVTT → SRT');
    await expect(cards.nth(1).locator('.sv-preview')).toContainText('00:00:05,000 --> 00:00:07,000');
  });

  test('handles tens of thousands of cues', async ({ page }) => {
    await page.goto('./');
    const parts = [];
    const t = (ms) => new Date(ms).toISOString().slice(11, 23).replace('.', ',');
    for (let i = 0; i < 30000; i++) parts.push(`${i + 1}\n${t(i * 2000)} --> ${t(i * 2000 + 1500)}\nLine ${i + 1}\n`);
    await page.setInputFiles('#file-input', { name: 'long.srt', mimeType: 'text/plain', buffer: Buffer.from(parts.join('\n')) });
    await expect(page.locator('.sv-cues')).toHaveText(/^30\D?000 cues$/);
  });

  test('works at 390px wide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./');
    await page.setInputFiles('#file-input', [fixture('harbor-lights.vtt'), fixture('edge-cases.srt'), fixture('sample.png')]);
    await expect(page.locator('.sv-card')).toHaveCount(3);
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    expect(widths.doc).toBeLessThanOrEqual(widths.win + 1);
    for (const sel of ['#dropzone', '#paste-input', '.sv-seg', '.sv-card']) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(391);
    }
    // stacked on phones: the paste box sits below the drop zone
    const dz = await page.locator('#dropzone').boundingBox();
    const pb = await page.locator('#paste-input').boundingBox();
    expect(pb.y).toBeGreaterThan(dz.y + dz.height - 1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.sv-download').first().click()]);
    expect(download.suggestedFilename()).toBe('harbor-lights.srt');
  });

  test('__demo shows finished results from the Harbor Lights fixtures', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => window.__demo());
    await expect(page.locator('.sv-card')).toHaveCount(2);
    await expect(page.locator('.sv-card .sv-cues').first()).toHaveText('6 cues');
  });
});
