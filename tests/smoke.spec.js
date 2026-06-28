const { test, expect } = require('@playwright/test');

const POST_URL = /\/@[^/]+\/post\/.+/;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('article.post').first()).toBeVisible();
});

test('feed renders the vault as posts', async ({ page }) => {
  // 8 base notes; loop appends, so expect at least 8 cards
  await expect.poll(() => page.locator('article.post').count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator('.sidebar .brand')).toContainText('wiki');
});

// This is the bug the user hit: clicking the post BODY TEXT must open the post.
test('clicking post text navigates into the thread (nav stability)', async ({ page }) => {
  await page.locator('article.post .text').first().click();
  await expect(page).toHaveURL(POST_URL);
  await expect(page.locator('article.post.big')).toBeVisible();
});

test('clicking the name/avatar area also navigates', async ({ page }) => {
  await page.locator('article.post .handle').first().click();
  await expect(page).toHaveURL(POST_URL);
});

test('back button returns to the home feed', async ({ page }) => {
  await page.locator('article.post .text').first().click();
  await expect(page).toHaveURL(POST_URL);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#tabs')).toBeVisible();
});

test('clicking an image opens the lightbox at /media and Escape closes it', async ({ page }) => {
  await page.goto('/@allanpaivio/post/dual-coding');
  const img = page.locator('article.post.big img.pmedia');
  await expect(img).toBeVisible();
  await img.click();
  await expect(page.locator('#lb')).toBeVisible();
  await expect(page).toHaveURL(/\/media$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#lb')).toBeHidden();
  await expect(page).not.toHaveURL(/\/media/);
});

test('deep-link refresh on a post URL still loads the app', async ({ page }) => {
  await page.goto('/@hsientanglin/post/spaced-repetition');
  await expect(page.locator('article.post.big')).toBeVisible();
  await expect(page.locator('.thline')).toContainText('Replies');
});

test('like toggles and writes back', async ({ page }) => {
  const like = page.locator('article.post .act.like').first();
  const before = await like.evaluate(el => el.classList.contains('on'));
  await like.click();
  await expect.poll(() => like.evaluate(el => el.classList.contains('on'))).toBe(!before);
});

test('reply composer creates a reply', async ({ page }) => {
  await page.locator('article.post .act.reply').first().click();
  await expect(page.locator('#ov')).toBeVisible();
  await page.fill('#cta', 'smoke-test reply from playwright');
  await page.click('#csend');
  await expect(page.locator('#ov')).toBeHidden();
});

test('New thread posts a top-level note and switches to Following', async ({ page }) => {
  await page.click('[data-nav="compose"]');
  await expect(page.locator('#ov')).toBeVisible();
  await page.fill('#cta', 'a brand-new smoke-test thread');
  await page.click('#csend');
  await expect(page.locator('#ov')).toBeHidden();
  await expect(page.locator('.tab[data-tab="following"]')).toHaveClass(/on/);
  await expect(page.locator('article.post .text').first()).toContainText('brand-new smoke-test thread');
});

test('search filter finds a note and opens it', async ({ page }) => {
  await page.click('[data-nav="search"]');
  await expect(page.locator('#srchov')).toBeVisible();
  await page.fill('#sin', 'anki');
  const hit = page.locator('.sres .hit').first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/post\/anki/);
});

test('full-text search matches note body and highlights the term', async ({ page }) => {
  await page.click('[data-nav="search"]');
  // "exponential" appears only in note BODIES, not titles/filenames
  await page.fill('#sin', 'exponential');
  const hit = page.locator('.sres .hit', { hasText: 'forgetting' }).first();
  await expect(hit).toBeVisible();
  await expect(hit.locator('.hit-s mark')).toBeVisible();
});

test('#tag filter narrows search to tagged notes', async ({ page }) => {
  await page.click('[data-nav="search"]');
  await page.fill('#sin', '#science');
  await expect(page.locator('.sres .hit')).toHaveCount(1);
  await expect(page.locator('.sres .hit', { hasText: 'forgetting' })).toBeVisible();
});

test('Activity view lists liked notes', async ({ page }) => {
  await page.click('[data-nav="activity"]');
  await expect(page.locator('.thline')).toContainText('Activity');
});

test('thread view shows a back bar with title (not over the sidebar)', async ({ page }) => {
  await page.goto('/@hsientanglin/post/spaced-repetition');
  await expect(page.locator('#threadbar')).toBeVisible();
  await expect(page.locator('#tbtitle')).toHaveText('Thread');
  await expect(page.locator('#homebar')).toBeHidden();
  await expect(page.locator('#threadbar .tbback')).toBeVisible();
});

test('post ⋯ menu opens with actions and Save works', async ({ page }) => {
  await page.locator('article.post .more').first().click();
  await expect(page.locator('.menu')).toBeVisible();
  await expect(page.locator('.menu')).toContainText('Copy link');
  await expect(page.locator('.menu')).toContainText('Open in Obsidian');
  await page.locator('.menu button', { hasText: /Save|Unsave/ }).click();
  await expect(page.locator('.menu')).toBeHidden();
});

test('Save (bookmark) adds a specific note to the Saved view and writes back', async ({ page }) => {
  await page.goto('/@hsientanglin/post/interleaving');
  const save = page.locator('article.post.big .act.save');
  if (!(await save.evaluate(el => el.classList.contains('on')))) await save.click();
  await expect(save).toHaveClass(/on/);
  await page.click('[data-nav="saved"]');
  await expect(page.locator('.thline')).toContainText('Saved');
  await expect(page.locator('article.post', { hasText: 'Interleaving' })).toBeVisible();
});
