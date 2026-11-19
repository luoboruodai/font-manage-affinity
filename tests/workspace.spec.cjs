'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { expect, test } = require('@playwright/test');

const evidence = path.join(__dirname, '..', 'private', 'validation', 'v05', 'ui-test');
const search = page => page.getByRole('searchbox', { name: '搜索字体' });
const previewText = page => page.getByRole('textbox', { name: '字体预览文字' });
const PREVIEW_LABELS = { latin: '西文', 'zh-Hans': '简体中文', 'zh-Hant': '繁体中文', ja: '日文', ko: '韩文', digits: '数字', symbols: '符号' };
async function setPreviewType(page, value) {
  const select = page.getByRole('combobox', { name: '预览文本类型' });
  if (await select.inputValue() === value) return;
  await Promise.all([
    page.waitForResponse(response => {
      if (!response.url().endsWith('/api/state') || !response.ok()) return false;
      const body = response.request().postDataJSON();
      return body?.type === 'settings' && body.settings?.language === value;
    }),
    select.selectOption(value)
  ]);
}
async function resetPreview(page) {
  await page.getByRole('button', { name: '恢复当前类型默认样例', exact: true }).click();
}
const list = page => page.getByRole('listbox', { name: '字体列表' });
const rows = page => page.locator('.font-row');
const ariaRow = page => page.locator('.font-row[data-font="ArialMT"]');

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__fontManage);
}

async function previewReady(row) {
  const image = row.locator('img');
  await expect(image).toHaveAttribute('src', /^data:image\/png;base64,iVBORw0KGgo/);
  return image.getAttribute('src');
}

async function enterArial(page) {
  await search(page).fill('ArialMT');
  await expect(ariaRow(page)).toBeVisible();
}

async function coverageFilter(page, enabled) {
  await setPreviewType(page, enabled ? 'latin' : 'all');
}

async function scrollFraction(page, fraction) {
  return list(page).evaluate(async (element, top) => {
    const t = performance.now();
    element.scrollTop = (element.scrollHeight - element.clientHeight) * top;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - t;
  }, fraction);
}

async function ensureGroup(page, name) {
  await page.getByRole('button', { name: '创建分组', exact: true }).click();
  const field = page.getByRole('textbox', { name: '分组名称' });
  await expect(field).toBeFocused();
  await field.fill(name);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.locator('#group-select option:checked')).toHaveText(`${name} · 0`);
}

test('loads real fonts, virtualizes the full list, and captures the three window sizes', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const started = performance.now();
  await ready(page);
  await coverageFilter(page, false);
  const firstReadyMs = performance.now() - started;
  const catalog = await (await request.get('/api/bootstrap')).json();
  expect(catalog.fonts.length).toBeGreaterThan(2000);
  expect(catalog.host.connected).toBe(false);
  expect(await rows(page).count()).toBeLessThan(25);
  await expect(rows(page).first()).toHaveAttribute('aria-posinset', '1');
  await expect(rows(page).first()).toHaveAttribute('aria-setsize', String(catalog.fonts.length));
  await expect(page.getByRole('button', { name: /上一页|下一页/ })).toHaveCount(0);
  await scrollFraction(page, 1);
  await expect(rows(page).last()).toHaveAttribute('aria-posinset', String(catalog.fonts.length));
  expect(await rows(page).count()).toBeLessThan(25);
  await scrollFraction(page, 0);
  await expect(rows(page).first()).toHaveAttribute('aria-posinset', '1');

  for (const [width, height] of [[380, 650], [520, 780], [900, 700]]) {
    await page.setViewportSize({ width, height });
    await ready(page);
    await previewReady(rows(page).first());
    await rows(page).first().locator('img').evaluate(image => image.decode());
    const bounds = await page.evaluate(() => {
      const footer = document.querySelector('footer').getBoundingClientRect();
      const list = document.querySelector('#font-list').getBoundingClientRect();
      return { body: document.documentElement.scrollWidth, footerBottom: footer.bottom, listHeight: list.height };
    });
    expect(bounds.body).toBe(width);
    expect(bounds.footerBottom).toBeLessThanOrEqual(height);
    expect(bounds.listHeight).toBeGreaterThan(300);
    await page.screenshot({ path: path.join(evidence, `workspace-${width}x${height}.png`) });
  }
  expect(errors).toEqual([]);
  console.log(`Real catalog: ${catalog.fonts.length} fonts, UI ready in ${firstReadyMs.toFixed(1)}ms`);
});

test('searches and filters fonts and keeps preset previews separate from custom text', async ({ page, request }) => {
  await ready(page);
  await coverageFilter(page, true);
  await search(page).fill('Arial');
  await expect(rows(page).first()).toBeVisible();
  const bootstrap = await (await request.get('/api/bootstrap')).json();
  const resultCount = async () => page.evaluate(() => window.__fontManage.results);
  const matchesArial = font => `${font.family} ${font.style} ${font.id}`.toLowerCase().includes('arial');
  const supportedLatin = font => font.languages.includes('latin');
  expect(await resultCount()).toBe(bootstrap.fonts.filter(font => matchesArial(font) && supportedLatin(font)).length);
  await page.getByRole('combobox', { name: '字体分类' }).selectOption('serif');
  expect(await resultCount()).toBe(bootstrap.fonts.filter(font => matchesArial(font) && font.isSerif && supportedLatin(font)).length);
  await expect(ariaRow(page)).toHaveCount(0);
  await search(page).fill('');
  await page.getByRole('combobox', { name: '字体分类' }).selectOption('all');
  await setPreviewType(page, 'all');
  await page.getByRole('combobox', { name: '字体分类' }).selectOption('mono');
  const mono = bootstrap.fonts.filter(font => font.isMonospaced).length;
  expect(await resultCount()).toBe(mono);
  await page.getByRole('combobox', { name: '字体分类' }).selectOption('all');
  await enterArial(page);

  const defaults = {};
  for (const language of ['latin', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'digits', 'symbols']) {
    await setPreviewType(page, language);
    defaults[language] = await previewText(page).inputValue();
  }
  expect(new Set(Object.values(defaults)).size).toBe(7);
  await setPreviewType(page, 'latin');
  const first = await previewReady(ariaRow(page));
  await previewText(page).fill('Editable preview 1234');
  await expect(ariaRow(page).locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(await ariaRow(page).locator('img').getAttribute('src')).not.toBe(first);
  for (const language of ['zh-Hans', 'zh-Hant', 'ja', 'ko', 'digits', 'symbols']) {
    await setPreviewType(page, language);
    await expect(previewText(page)).toHaveValue(defaults[language]);
  }
  await setPreviewType(page, 'latin');
  await expect(previewText(page)).toHaveValue('Editable preview 1234');
  await resetPreview(page);
  await expect(previewText(page)).toHaveValue(defaults.latin);
  await setPreviewType(page, 'symbols');
  await expect(previewText(page)).toHaveValue(/★/);
  await setPreviewType(page, 'zh-Hans');
  await expect(previewText(page)).toHaveValue(/简体中文/);
  expect(await resultCount()).toBe(0);
  await setPreviewType(page, 'all');
  await previewText(page).fill('简体中文之美😀');
  await expect(ariaRow(page).locator('.diagnostic')).toContainText(/缺字.*已阻止回退/);

  const q = new URLSearchParams({ id: 'ArialMT', text: '中😀𠮷', width: '360', size: '28' });
  const raw = await (await request.get('/api/preview?' + q)).json();
  expect(raw.actualPostscript).toBe('ArialMT');
  expect(raw.missing).toEqual(['中', '😀', '𠮷']);
  expect(raw.fallback).toEqual(expect.arrayContaining(['AppleColorEmoji']));
  const opaqueBounds = await page.evaluate(async png => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((channel, index) => index % 4 === 3 && channel > 0);
  }, raw.png);
  expect(opaqueBounds).toBe(false);

  await setPreviewType(page, 'zh-Hans');
  expect(await resultCount()).toBe(bootstrap.fonts.filter(font => font.id.toLowerCase().includes('arialmt') && font.languages.includes('zh-Hans')).length);
  await setPreviewType(page, 'latin');
});

test('filters simplified and traditional Chinese by core coverage while keeping partial fonts', async ({ page, request }) => {
  await ready(page);
  await coverageFilter(page, true);
  const count = () => page.evaluate(() => window.__fontManage.results);
  await setPreviewType(page, 'zh-Hans');
  await expect(previewText(page)).toHaveValue(/简体中文/);
  await search(page).fill('AlibabaHealthFont20CN-45R');
  expect(await count()).toBe(1);
  await previewReady(rows(page).first());
  await previewText(page).fill('龘𠮷😀 0123');
  await expect(rows(page).first().locator('.diagnostic')).toContainText(/缺字/);
  expect(await count()).toBe(1);
  await setPreviewType(page, 'zh-Hant');
  expect(await count()).toBe(0);
  await search(page).fill('AppleSDGothicNeo-Regular');
  expect(await count()).toBe(1);
  await setPreviewType(page, 'zh-Hans');
  expect(await count()).toBe(0);
  await search(page).fill('NotoSansCJKsc-Regular');
  expect(await count()).toBe(1);
  await setPreviewType(page, 'zh-Hant');
  expect(await count()).toBe(1);
  await search(page).fill('ArialMT');
  expect(await count()).toBe(0);
  await setPreviewType(page, 'zh-Hans');
  expect(await count()).toBe(0);
  const excluded = await (await request.get('/api/diagnostics?language=zh-Hant')).json();
  const simplifiedOnly = excluded.diagnostics.find(item => item.font === 'AlibabaHealthFont20CN-45R');
  expect(simplifiedOnly.supported).toBe(false);
  expect(simplifiedOnly.reason).toBe('below-core-threshold');
  expect(simplifiedOnly.missingCore).toContain('體');
  const allHant = await (await request.get('/api/diagnostics?language=zh-Hant&only=all')).json();
  const partial = allHant.diagnostics.find(item => item.font === 'BokutohNStd-Bold');
  expect(partial.supported).toBe(true);
  expect(partial.missing).toContain('說');
  await resetPreview(page);
  await setPreviewType(page, 'zh-Hans');
  await search(page).fill('PingFangSC');
  await previewReady(rows(page).first());
  await page.screenshot({ path: path.join(evidence, 'simplified-list-520x780.png') });
  await setPreviewType(page, 'zh-Hant');
  await search(page).fill('PingFangTC');
  await previewReady(rows(page).first());
  await page.screenshot({ path: path.join(evidence, 'traditional-list-520x780.png') });
  await setPreviewType(page, 'latin');
  await coverageFilter(page, false);
});

test('filters Hangul independently and reflows complete previews with visible diagnostics', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 780 });
  await ready(page);
  await coverageFilter(page, true);
  await setPreviewType(page, 'ko');
  await expect(previewText(page)).toHaveValue(/한글/);
  await search(page).fill('AppleSDGothicNeo');
  const row = rows(page).first();
  await expect(row).toBeVisible();
  await previewReady(row);
  const shortSource = await row.locator('img').getAttribute('src');
  const shortHeight = (await row.boundingBox()).height;
  await previewText(page).fill(('가나다라마바사 한글 서울 '.repeat(24) + '😀').slice(0, 500));
  await expect.poll(async () => (await row.locator('img').getAttribute('src')) !== shortSource).toBe(true);
  await previewReady(row);
  const longHeight = (await row.boundingBox()).height;
  expect(longHeight).toBeGreaterThan(shortHeight);
  await expect(row.locator('.diagnostic')).toContainText(/缺字/);
  const narrow = await row.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const diagnostic = element.querySelector('.diagnostic').getBoundingClientRect();
    const image = element.querySelector('img').getBoundingClientRect();
    return { rowBottom: rect.bottom, diagnosticBottom: diagnostic.bottom, imageBottom: image.bottom, diagnosticTop: diagnostic.top, bodyWidth: document.documentElement.scrollWidth };
  });
  expect(narrow.imageBottom).toBeLessThanOrEqual(narrow.diagnosticTop);
  expect(narrow.diagnosticBottom).toBeLessThanOrEqual(narrow.rowBottom);
  expect(narrow.bodyWidth).toBe(520);
  const longSource = await row.locator('img').getAttribute('src');
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(async () => (await row.locator('img').getAttribute('src')) !== longSource).toBe(true);
  await previewReady(row);
  expect((await row.boundingBox()).height).toBeLessThan(longHeight);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  await page.screenshot({ path: path.join(evidence, 'korean-adaptive-900x700.png') });
  await search(page).fill('ArialMT');
  await expect(rows(page)).toHaveCount(0);
  await setPreviewType(page, 'latin');
  await coverageFilter(page, false);
});

test('persists a cleared category and an edit made immediately before close', async ({ page }) => {
  await ready(page);
  const kind = page.getByRole('combobox', { name: '字体分类' });
  const savedKind = value => page.waitForResponse(response => {
    if (!response.url().endsWith('/api/state') || !response.ok()) return false;
    const body = response.request().postDataJSON();
    return body?.type === 'settings' && body.settings.kind === value;
  });
  await Promise.all([savedKind('mono'), kind.selectOption('mono')]);
  await Promise.all([savedKind('all'), kind.selectOption('all')]);
  await ready(page);
  await expect(kind).toHaveValue('all');
  expect(await page.evaluate(() => window.__fontManage.results)).toBeGreaterThan(2000);

  await enterArial(page);
  let recordFavoriteRequest;
  let releaseFavorite;
  const favoriteQueued = new Promise(resolve => { recordFavoriteRequest = resolve; });
  const favoriteResponseGate = new Promise(resolve => { releaseFavorite = resolve; });
  await page.route('**/api/state', async route => {
    const body = route.request().postDataJSON();
    if (body?.type === 'favorite') {
      recordFavoriteRequest();
      await favoriteResponseGate;
    }
    await route.continue();
  });
  await ariaRow(page).locator('.star').click();
  await favoriteQueued;
  const closing = page.evaluate(() => {
    window.close = () => { window.__closedForTest = true; };
    const input = document.querySelector('#preview-text');
    input.value = '立即关闭前的预览 Text 0123';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    window.__closeStartedForTest = true;
    return window.fontManageClose();
  });
  try {
    await page.waitForFunction(() => window.__closeStartedForTest);
  } finally {
    releaseFavorite();
  }
  await closing;
  await expect.poll(() => page.evaluate(() => window.__closedForTest)).toBe(true);
  await ready(page);
  await expect(previewText(page)).toHaveValue('立即关闭前的预览 Text 0123');
  await enterArial(page);
  await expect(ariaRow(page).locator('.star')).toHaveAttribute('aria-pressed', 'true');
  await ariaRow(page).locator('.star').click();
  await expect(ariaRow(page).locator('.star')).toHaveAttribute('aria-pressed', 'false');
  await resetPreview(page);
  await page.evaluate(() => {
    window.close = () => {};
    return window.fontManageClose();
  });
});

test('persists favorite and unfavorite and keeps the list usable while disconnected', async ({ page }) => {
  await ready(page);
  await enterArial(page);
  const star = ariaRow(page).locator('.star');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(ariaRow(page).locator('.star')).toHaveAttribute('aria-pressed', 'true');
  await ariaRow(page).click();
  await expect(page.getByRole('button', { name: '应用字体' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '应用字体' })).toHaveAttribute('title', /正在|未连接|失败|未运行/);
  await expect(page.getByRole('button', { name: '应用字体' })).not.toHaveAttribute('title', /脚本库/);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: /重试连接|启动 Affinity/ })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await ariaRow(page).locator('.star').click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('还没有收藏')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.getByText('还没有收藏')).toBeVisible();
});

test('collapses the preview bar, keeps per-language custom text, and ties batch actions to selection', async ({ page }) => {
  await ready(page);
  const savedSettings = predicate => page.waitForResponse(response => {
    if (!response.url().endsWith('/api/state') || !response.ok()) return false;
    const body = response.request().postDataJSON();
    return body?.type === 'settings' && predicate(body.settings);
  });
  await setPreviewType(page, 'zh-Hans');
  await Promise.all([
    savedSettings(settings => settings.customTexts?.['zh-Hans'] === '自定义预览 Sample 88'),
    previewText(page).fill('自定义预览 Sample 88')
  ]);
  await Promise.all([
    savedSettings(settings => settings.language === 'latin' && settings.customTexts?.['zh-Hans'] === '自定义预览 Sample 88'),
    setPreviewType(page, 'latin')
  ]);
  await expect(previewText(page)).toHaveValue(/quick brown fox/);
  await page.reload();
  await page.waitForFunction(() => !!window.__fontManage);
  await expect(previewText(page)).toHaveValue(/quick brown fox/);
  await setPreviewType(page, 'zh-Hans');
  await expect(previewText(page)).toHaveValue('自定义预览 Sample 88');
  await Promise.all([
    savedSettings(settings => !settings.customTexts?.['zh-Hans'] && settings.language === 'zh-Hans'),
    resetPreview(page)
  ]);
  await expect(previewText(page)).toHaveValue(/简体中文/);

  await Promise.all([
    savedSettings(settings => settings.previewCollapsed === true),
    page.getByRole('button', { name: '折叠预览栏' }).click()
  ]);
  await expect(previewText(page)).toBeHidden();
  const strip = page.locator('#preview-collapsed');
  await expect(strip).toBeVisible();
  await expect(strip.locator('#collapsed-text')).toContainText('天地玄黄');
  await expect(strip.locator('#collapsed-lang')).toHaveText('简体中文');
  await page.reload();
  await page.waitForFunction(() => !!window.__fontManage);
  await expect(page.locator('#preview-collapsed')).toBeVisible();
  await expect(previewText(page)).toBeHidden();
  await page.locator('#preview-collapsed').click();
  await expect(previewText(page)).toBeVisible();
  await expect(previewText(page)).toBeFocused();

  await setPreviewType(page, 'all');
  await enterArial(page);
  await ariaRow(page).click();
  expect(await page.evaluate(() => window.__fontManage.selection)).toEqual(['ArialMT']);
  await ariaRow(page).click({ modifiers: ['Meta'] });
  expect(await page.evaluate(() => window.__fontManage.selection)).toEqual([]);
  await ariaRow(page).getByRole('button', { name: '将 Arial 加入分组', exact: true }).click();
  const groupDialog = page.getByRole('dialog', { name: '加入分组' });
  await expect(groupDialog).toBeVisible();
  await expect(groupDialog).toContainText('整理 1 款字体');
  await page.keyboard.press('Escape');
  await expect(groupDialog).toBeHidden();
  await Promise.all([
    savedSettings(settings => settings.language === 'latin' && settings.previewCollapsed === false),
    setPreviewType(page, 'latin')
  ]);
});

test('creates, renames, validates, persists and removes memberships in independent groups', async ({ page }) => {
  await ready(page);
  await ensureGroup(page, '测试海报');
  const field = page.getByRole('textbox', { name: '分组名称' });
  const status = page.getByRole('status');
  await page.getByRole('button', { name: '创建分组', exact: true }).click();
  await field.fill('   ');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(status).toContainText('请输入分组名称');
  await field.fill('测试海报');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(status).toContainText('已有同名分组');
  await page.getByRole('button', { name: '取消分组编辑' }).click();
  await ensureGroup(page, '测试包装');
  const group = page.getByRole('combobox', { name: '当前分组' });
  const selectedGroup = page.locator('#group-select option:checked');
  await page.getByRole('button', { name: '重命名分组' }).click();
  await expect(field).toBeFocused();
  await field.fill('   ');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(status).toContainText('请输入分组名称');
  await field.fill('测试海报');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(status).toContainText('已有同名分组');
  await field.fill('测试包装改名');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(selectedGroup).toHaveText('测试包装改名 · 0');

  await page.getByRole('button', { name: '全部', exact: true }).click();
  await enterArial(page);
  await ariaRow(page).click();
  const add = ariaRow(page).getByRole('button', { name: '将 Arial 加入分组', exact: true });
  await add.click();
  await expect(page.getByRole('button', { name: '加入 测试海报', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '加入 测试包装改名', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  for (const name of ['测试海报', '测试包装改名']) {
    await add.click();
    await page.getByRole('button', { name: '加入 ' + name, exact: true }).click();
    await expect(status).toHaveText('已加入 ' + name);
  }
  await expect(ariaRow(page).locator('.row-meta')).toHaveText('2 组');
  await expect(ariaRow(page).locator('.row-meta')).toHaveAttribute('title', '测试海报、测试包装改名');
  await page.reload();
  await page.getByRole('button', { name: '分组', exact: true }).click();
  await expect(selectedGroup).toHaveText('测试海报 · 1');
  await expect(ariaRow(page)).toBeVisible();
  await group.selectOption({ label: '测试包装改名 · 1' });
  await expect(ariaRow(page)).toBeVisible();
  await ariaRow(page).click();
  await add.click();
  await page.getByRole('button', { name: '移出 测试包装改名', exact: true }).click();
  await expect(selectedGroup).toHaveText('测试包装改名 · 0');
  await expect(ariaRow(page)).toHaveCount(0);
  await page.getByRole('button', { name: '删除分组', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '保留' })).toBeFocused();
  await dialog.getByRole('button', { name: '删除分组', exact: true }).click();
  await expect(group.locator('option')).toHaveCount(1);
  await expect(selectedGroup).toHaveText('测试海报 · 1');
  await expect(ariaRow(page)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '分组', exact: true }).click();
  await expect(selectedGroup).toHaveText('测试海报 · 1');
  await expect(ariaRow(page)).toBeVisible();
});

test('supports keyboard navigation, command-click and clipped long names and samples', async ({ page, request }) => {
  await page.setViewportSize({ width: 380, height: 650 });
  await ready(page);
  await setPreviewType(page, 'all');
  await page.keyboard.press('Meta+f');
  await expect(search(page)).toBeFocused();
  await search(page).fill('Arial');
  await list(page).focus();
  await page.keyboard.press('Home');
  await expect(rows(page).first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(list(page)).toHaveAttribute('aria-activedescendant', await rows(page).nth(1).getAttribute('id'));
  await expect(rows(page).nth(1)).toHaveClass(/keyboard/);
  await rows(page).first().click({ modifiers: ['Meta'] });
  await expect(page.locator('.font-row[aria-selected="true"]')).toHaveCount(2);
  await expect(page.locator('#count')).toContainText('已选 2 款');
  await rows(page).first().click({ modifiers: ['Meta'] });
  await expect(page.locator('.font-row[aria-selected="true"]')).toHaveCount(1);
  const remaining = page.locator('.font-row[aria-selected="true"]');
  expect.soft(await page.evaluate(() => window.__fontManage.selection)).toEqual([await remaining.getAttribute('data-font')]);

  const catalog = await (await request.get('/api/bootstrap')).json();
  const longest = catalog.fonts.reduce((a, b) => a.family.length + a.style.length >= b.family.length + b.style.length ? a : b);
  await search(page).fill(longest.id);
  const longRow = rows(page).filter({ has: page.getByText(longest.family, { exact: true }) }).first();
  await expect(longRow).toBeVisible();
  await expect(longRow).toHaveAttribute('title', expect.stringContaining(longest.id));
  await longRow.click();
  await previewText(page).fill('Affinity Typography 空间设计 ＢⅣ→😀 '.repeat(20).slice(0, 500));
  await previewReady(longRow);
  const layout = await longRow.evaluate(element => {
    const sample = element.querySelector('.sample');
    const img = sample.querySelector('img');
    const heading = element.querySelector('.font-heading');
    const star = element.querySelector('.row-actions');
    const r = element.getBoundingClientRect();
    return {
      sampleOverflow: getComputedStyle(sample).overflowX,
      rowOverflow: getComputedStyle(element).overflowX,
      width: r.width,
      imageWidth: img.naturalWidth,
      headingRight: heading.getBoundingClientRect().right - parseFloat(getComputedStyle(heading).paddingRight),
      starLeft: star.getBoundingClientRect().left
    };
  });
  expect(layout.sampleOverflow).toBe('hidden');
  expect(layout.rowOverflow).toBe('hidden');
  expect(layout.width).toBeLessThan(380);
  expect(layout.imageWidth).toBeLessThanOrEqual(2 * 380);
  expect(layout.headingRight).toBeLessThanOrEqual(layout.starLeft);
  await page.screenshot({ path: path.join(evidence, 'long-title-and-text-380x650.png') });
  await resetPreview(page);
});

test('records real preview latency and bounded caches, plus synthetic 20,000-font scrolling', async ({ page, request }) => {
  test.setTimeout(120000);
  await ready(page);
  await coverageFilter(page, false);
  await expect.poll(async () => (await (await request.get('/api/bootstrap')).json()).settings.language).toBe('all');
  const catalog = await (await request.get('/api/bootstrap')).json();
  const initial = await (await request.get('/api/metrics')).json();
  const durations = [];
  const count = 105;
  const ids = catalog.fonts.slice(0, count).map(font => font.id);
  for (const id of ids) {
    const q = new URLSearchParams({ id, text: 'Measure 0123', width: '245', size: '27' });
    const started = performance.now();
    const response = await request.get('/api/preview?' + q);
    expect(response.ok()).toBe(true);
    await response.json();
    durations.push(performance.now() - started);
  }
  const q = new URLSearchParams({ id: ids.at(-1), text: 'Measure 0123', width: '245', size: '27' });
  await request.get('/api/preview?' + q);
  const counters = await (await request.get('/api/metrics')).json();
  expect(counters.previewCache).toBeLessThanOrEqual(96);
  expect(counters.cacheBytes).toBeLessThanOrEqual(24 * 1024 * 1024);
  expect(counters.hits).toBeGreaterThan(initial.hits);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const chromeHeap = async () => (await cdp.send('Performance.getMetrics')).metrics
    .find(metric => metric.name === 'JSHeapUsedSize').value;
  const heapBefore = await chromeHeap();
  const requestsInFlight = new Set();
  let peakInFlight = 0;
  page.on('request', req => {
    if (new URL(req.url()).pathname !== '/api/preview') return;
    requestsInFlight.add(req);
    peakInFlight = Math.max(peakInFlight, requestsInFlight.size);
  });
  const requestDone = req => requestsInFlight.delete(req);
  page.on('requestfinished', requestDone);
  page.on('requestfailed', requestDone);
  // A fresh sample forces real PNG generation during this scroll pass.
  await previewText(page).fill('Real scroll A–Z 0123');
  const jumps = 30;
  const finalJump = await list(page).evaluate(async (element, length) => {
    for (let index = 1; index <= length; index++) {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * index / length;
      if (index < length) await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return performance.now();
  }, jumps);
  await expect(rows(page).last()).toHaveAttribute('aria-posinset', String(catalog.fonts.length));
  const painted = await page.waitForFunction(() => {
    const view = document.querySelector('#font-list').getBoundingClientRect();
    const visible = [...document.querySelectorAll('.font-row')].filter(row => {
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > view.top && bounds.top < view.bottom;
    });
    if (!visible.length || !visible.every(row => {
      const image = row.querySelector('img');
      return image.complete && image.naturalWidth > 0 && image.src.startsWith('data:image/png;base64,');
    })) return false;
    return { time: performance.now(), visible: visible.length };
  }, null, { timeout: 15000 });
  const { time, visible } = await painted.jsonValue();
  const drained = async () => {
    const state = await page.evaluate(() => {
      const { previewRequests, previewResponses } = window.__fontManage.metrics;
      return previewRequests - previewResponses;
    });
    const running = await (await request.get('/api/metrics')).json();
    return [state, running.pending, requestsInFlight.size];
  };
  await expect.poll(drained, { timeout: 6000 }).toEqual([0, 0, 0]);
  const realScrollModel = await page.evaluate(() => ({
    maxRows: window.__fontManage.metrics.maxRows,
    browserPreviewCache: window.__fontManage.previewCache,
    previewResponses: window.__fontManage.metrics.previewResponses
  }));
  expect(realScrollModel.maxRows).toBeLessThan(25);
  expect(realScrollModel.browserPreviewCache).toBeLessThanOrEqual(64);
  expect(realScrollModel.previewResponses).toBeGreaterThan(jumps);
  expect(peakInFlight).toBeLessThanOrEqual(3);
  const realScrollService = await (await request.get('/api/metrics')).json();
  expect(realScrollService.previewCache).toBeLessThanOrEqual(96);
  expect(realScrollService.cacheBytes).toBeLessThanOrEqual(24 * 1024 * 1024);
  const realScroll = {
    fonts: catalog.fonts.length,
    scrollJumps: jumps,
    finalViewportImages: visible,
    finalViewportReadyMs: +(time - finalJump).toFixed(1),
    peakPreviewRequestsInFlight: peakInFlight,
    chromeUsedHeapBytesBefore: heapBefore,
    chromeUsedHeapBytesAfterDrain: await chromeHeap(),
    ...realScrollModel,
    serverAfterDrain: realScrollService
  };
  await cdp.detach();

  const fake = Array.from({ length: 20000 }, (_, i) => ({
    ...catalog.fonts[i % catalog.fonts.length],
    id: 'SimulatedPreview' + i,
    family: `Synthetic ${String(i).padStart(5, '0')}`
  }));
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { ...catalog, fonts: fake } }));
  await page.route('**/api/preview?*', route => route.fulfill({
    json: { width: 980, height: 152, png: null, missing: [], fallback: [], loadError: null }
  }));
  await ready(page);
  expect(await page.evaluate(() => window.__fontManage.results)).toBe(20000);
  const frames = [];
  for (let index = 0; index < 24; index++) {
    frames.push(await scrollFraction(page, index / 23));
    expect(await rows(page).count()).toBeLessThan(25);
  }
  await expect(rows(page).last()).toHaveAttribute('aria-posinset', '20000');
  const model = await page.evaluate(() => ({
    maxRows: window.__fontManage.metrics.maxRows,
    cache: window.__fontManage.previewCache
  }));
  expect(model.cache).toBeLessThanOrEqual(64);
  const p95 = values => +values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1].toFixed(1);
  const results = {
    realCoreText: { sequentialRequests: count, p95MsRoundTripIncludingResponseJson: p95(durations), markers: counters },
    realCatalogScrolling: realScroll,
    synthetic20000: { scrollJumps: frames.length, p95MsTwoAnimationFrames: p95(frames), ...model }
  };
  fs.writeFileSync(path.join(evidence, 'performance.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results));
});
