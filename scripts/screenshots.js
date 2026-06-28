// Generate README screenshots with Playwright.
//   node scripts/screenshots.js   (or: pnpm shots)
// Spins up the server against a throwaway copy of ./vault so the real vault
// is never mutated, captures key views at 2x, writes them to assets/.
'use strict';
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 4191;
const ROOT = path.resolve(__dirname, '..');
const SHOT_VAULT = path.join(ROOT, '.shot-vault');
const OUT = path.join(ROOT, 'assets');
const base = 'http://localhost:' + PORT;

const wait = ms => new Promise(r => setTimeout(r, ms));
const ping = () => new Promise(res => {
  const req = http.get(base + '/', r => { r.resume(); res(r.statusCode === 200); });
  req.on('error', () => res(false));
  req.setTimeout(500, () => { req.destroy(); res(false); });
});

(async () => {
  fs.rmSync(SHOT_VAULT, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'vault'), SHOT_VAULT, { recursive: true });
  fs.rmSync(path.join(SHOT_VAULT, '.wiki-thread'), { recursive: true, force: true });

  const srv = spawn('node', ['server.js', SHOT_VAULT, String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40 && !(await ping()); i++) await wait(150);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const shot = name => page.screenshot({ path: path.join(OUT, name) });

    await page.goto(base + '/'); await page.waitForSelector('article.post'); await wait(400);
    await shot('feed.png');

    await page.goto(base + '/@allanpaivio/post/dual-coding'); await page.waitForSelector('article.post.big img.pmedia'); await wait(500);
    await shot('thread.png');

    await page.goto(base + '/'); await page.waitForSelector('article.post');
    await page.evaluate(() => openSearch());
    await page.fill('#sin', 'recall memory'); await wait(400);
    await shot('search.png');

    await page.goto(base + '/@allanpaivio/post/dual-coding/media'); await page.waitForSelector('#lb.on'); await wait(500);
    await shot('lightbox.png');

    await page.goto(base + '/@hsientanglin/post/spaced-repetition'); await page.waitForSelector('article.post.big');
    await page.click('article.post.big .more'); await page.waitForSelector('.menu'); await wait(250);
    await shot('menu.png');

    await browser.close();
    console.log('✓ screenshots written to assets/: feed, thread, search, lightbox, menu (.png)');
  } finally {
    srv.kill();
    fs.rmSync(SHOT_VAULT, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
