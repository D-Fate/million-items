import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function resetSelection(request: APIRequestContext): Promise<void> {
  let items: string[];
  do {
    const page = await (await request.get('/api/items?side=selected')).json();
    items = page.items;
    await Promise.all(items.map(id => request.put('/api/selection', { data: { id, selected: false } })));
  } while (items.length);
}

async function seedSelection(request: APIRequestContext, ids: string[]): Promise<void> {
  for (const id of ids) {
    expect((await request.put('/api/selection', { data: { id, selected: true } })).ok()).toBe(true);
  }
}

async function visibleIds(page: Page, side: string): Promise<string[]> {
  return page.getByTestId(side).locator('.item-id').allTextContents();
}

test.beforeEach(async ({ request }) => resetSelection(request));

test('initial pages, infinite scroll and filtered pagination stay within twenty items', async ({ page }) => {
  const sizes: number[] = [];
  page.on('response', async response => {
    if (response.url().includes('/api/items?') && response.ok()) sizes.push((await response.json()).items.length);
  });
  await page.goto('/');
  const available = page.getByTestId('available');
  await expect(available.locator('.item-row')).toHaveCount(20);
  await expect(page.getByTestId('selected').getByText('Ваша подборка начинается здесь')).toBeVisible();
  await available.locator('.list-viewport').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(available.locator('.item-row')).toHaveCount(40);
  await page.getByRole('searchbox', { name: 'Поиск среди всех элементов' }).fill('99');
  await expect(available.locator('.item-row')).toHaveCount(20);
  expect((await visibleIds(page, 'available')).every(id => id.includes('99'))).toBe(true);
  await available.locator('.list-viewport').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(available.locator('.item-row')).toHaveCount(40);
  expect(sizes.length).toBeGreaterThanOrEqual(5);
  expect(sizes.every(size => size <= 20)).toBe(true);
});

test('selection survives reload and filters do not', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Выбрать 1', exact: true }).click();
  await expect(page.getByTestId('selected').locator('.item-row')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Поиск среди всех элементов' }).fill('abc');
  await page.getByRole('searchbox', { name: 'Поиск среди выбранных' }).fill('1');
  await page.reload();
  await expect(page.getByTestId('selected').locator('.item-id')).toHaveText('1');
  await expect(page.getByRole('searchbox', { name: 'Поиск среди всех элементов' })).toHaveValue('');
  await expect(page.getByRole('searchbox', { name: 'Поиск среди выбранных' })).toHaveValue('');
  await page.getByRole('button', { name: 'Убрать 1', exact: true }).click();
  await expect(page.getByTestId('selected').locator('.item-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать 1', exact: true })).toBeVisible();
});

test('adds arbitrary text IDs and shows duplicate errors', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('ID нового элемента').fill('проект / <hello>');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByTestId('available').locator('.item-id')).toHaveText(['проект / <hello>']);
  await page.getByLabel('ID нового элемента').fill('проект / <hello>');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByText('Элемент с таким ID уже существует.')).toBeVisible();
});

test('drag and drop works with a filter and preserves hidden items and saved order', async ({ page, request }) => {
  await seedSelection(request, ['1', '2', '11', '3', '21', '4']);
  await page.goto('/');
  const selected = page.getByTestId('selected');
  await page.getByRole('searchbox', { name: 'Поиск среди выбранных' }).fill('1');
  await expect(selected.locator('.item-row')).toHaveCount(3);
  const source = await page.getByRole('button', { name: 'Перетащить 21', exact: true }).boundingBox();
  const target = await selected.locator('[data-id="1"]').boundingBox();
  if (!source || !target) throw new Error('Drag elements are not visible');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, source.y - 8, { steps: 3 });
  await page.mouse.move(target.x + 32, target.y + 5, { steps: 16 });
  await page.mouse.up();
  await expect.poll(() => visibleIds(page, 'selected')).toEqual(['21', '1', '11']);
  await page.getByRole('searchbox', { name: 'Поиск среди выбранных' }).fill('');
  await expect.poll(() => visibleIds(page, 'selected')).toEqual(['21', '1', '2', '11', '3', '4']);
  await page.reload();
  await expect.poll(() => visibleIds(page, 'selected')).toEqual(['21', '1', '2', '11', '3', '4']);
});

test('selected list scrolls and keyboard controls reorder loaded items', async ({ page, request }) => {
  await seedSelection(request, Array.from({ length: 45 }, (_, i) => String(i + 1)));
  await page.goto('/');
  const selected = page.getByTestId('selected');
  await expect(selected.locator('.item-row')).toHaveCount(20);
  await selected.locator('.list-viewport').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(selected.locator('.item-row')).toHaveCount(40);
  await selected.locator('.list-viewport').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(selected.locator('.item-row')).toHaveCount(45);
  await page.getByRole('button', { name: 'Поднять 45', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Порядок сохранён.', { exact: true })).toBeVisible();
  const all: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await (await request.get('/api/items', { params: { side: 'selected', ...(cursor ? { cursor } : {}) } })).json();
    all.push(...result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  expect(all.slice(-2)).toEqual(['45', '44']);
});

test('recovers from another client changing a paginated list', async ({ page, request }) => {
  await page.goto('/');
  const available = page.getByTestId('available');
  await expect(available.locator('.item-row')).toHaveCount(20);
  await request.put('/api/selection', { data: { id: '1', selected: true } });
  await available.locator('.list-viewport').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(available.locator('.item-row').first()).toHaveAttribute('data-id', '2');
  expect(new Set(await visibleIds(page, 'available')).size).toBe(20);
  await expect(page.getByText('Данные изменились в другой вкладке. Список обновлён.')).toBeVisible();
});

test('shows network failure and can retry', async ({ page }) => {
  await page.route('**/api/items?**', route => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('available').getByRole('alert')).toContainText('Нет ответа от сервера');
  await page.unroute('**/api/items?**');
  await page.getByTestId('available').getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.getByTestId('available').locator('.item-row')).toHaveCount(20);
});

test('mobile layout has no horizontal overflow or browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('available').locator('.item-row')).toHaveCount(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Выбрать 1', exact: true }).click();
  await expect(page.getByTestId('selected').locator('.item-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('switching filters cancels an older pending result', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('available').locator('.item-row')).toHaveCount(20);
  await page.route('**/api/items?side=available&q=999', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  const first = page.waitForRequest(request => request.url().endsWith('q=999'));
  const search = page.getByRole('searchbox', { name: 'Поиск среди всех элементов' });
  await search.fill('999');
  await first;
  await search.fill('1000000');
  await expect(page.getByTestId('available').locator('.item-id')).toHaveText(['1000000']);
  await expect(search).toHaveValue('1000000');
});
