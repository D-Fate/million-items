import { describe, expect, it } from 'vitest';
import { ItemStore } from '../../server/src/store.js';

describe('ItemStore', () => {
  it('represents one million initial IDs and returns exactly twenty per page', async () => {
    const store = new ItemStore();
    const first = await store.list({ side: 'available', query: '' });
    const second = await store.list({ side: 'available', query: '', cursor: first.nextCursor! });
    expect(first.totals.all).toBe(1_000_000);
    expect(first.items).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    expect(second.items).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 21)));
  });

  it('finds a sparse result at the end of the million-item range', async () => {
    const store = new ItemStore();
    expect((await store.list({ side: 'available', query: '1000000' })).items).toEqual(['1000000']);
    expect((await store.list({ side: 'available', query: 'missing' })).nextCursor).toBeNull();
  });

  it('excludes selected IDs from available pages and keeps selection unique', async () => {
    const store = new ItemStore(50);
    store.select('1', true);
    const revision = store.revision;
    store.select('1', true);
    expect(store.revision).toBe(revision);
    expect((await store.list({ side: 'available', query: '' })).items[0]).toBe('2');
    expect((await store.list({ side: 'selected', query: '' })).items).toEqual(['1']);
    store.select('1', false);
    expect((await store.list({ side: 'available', query: '' })).items[0]).toBe('1');
  });

  it('rejects duplicates in both initial and custom IDs, including selected IDs', () => {
    const store = new ItemStore();
    store.select('1', true);
    expect(() => store.add('1')).toThrow('уже существует');
    store.add('custom');
    expect(() => store.add('custom')).toThrow('уже существует');
    store.add('001');
    store.add('-42');
    store.add('привет');
    expect(store.state().totals.all).toBe(1_000_004);
  });

  it('paginates filtered results without duplicates or missing items', async () => {
    const store = new ItemStore(250);
    store.select('12', true);
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await store.list({ side: 'available', query: '2', cursor });
      expect(page.items.length).toBeLessThanOrEqual(20);
      ids.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 250 }, (_, i) => String(i + 1)).filter(id => id.includes('2') && id !== '12'));
  });

  it('paginates selected elements in their saved order', async () => {
    const store = new ItemStore(50);
    for (let i = 45; i >= 1; i--) store.select(String(i), true);
    const first = await store.list({ side: 'selected', query: '' });
    const second = await store.list({ side: 'selected', query: '', cursor: first.nextCursor! });
    const last = await store.list({ side: 'selected', query: '', cursor: second.nextCursor! });
    expect([first.items.length, second.items.length, last.items.length]).toEqual([20, 20, 5]);
    expect([...first.items, ...second.items, ...last.items]).toEqual(Array.from({ length: 45 }, (_, i) => String(45 - i)));
    expect(last.nextCursor).toBeNull();
  });

  it('paginates selected results with an active filter', async () => {
    const store = new ItemStore(300);
    for (let i = 1; i <= 300; i++) store.select(String(i), true);
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await store.list({ side: 'selected', query: '1', cursor });
      expect(page.items.length).toBeLessThanOrEqual(20);
      ids.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 300 }, (_, i) => String(i + 1)).filter(id => id.includes('1')));
  });

  it('moves relative to visible anchors without losing hidden or unloaded items', async () => {
    const store = new ItemStore(100);
    for (const id of ['1', '2', '11', '3', '21', '4']) store.select(id, true);
    const filtered = await store.list({ side: 'selected', query: '1' });
    expect(filtered.items).toEqual(['1', '11', '21']);
    store.move({ id: '21', targetId: '1', placement: 'before', revision: filtered.revision });
    expect((await store.list({ side: 'selected', query: '' })).items).toEqual(['21', '1', '2', '11', '3', '4']);
    store.move({ id: '21', targetId: '11', placement: 'after', revision: store.revision });
    expect((await store.list({ side: 'selected', query: '' })).items).toEqual(['1', '2', '11', '21', '3', '4']);
  });

  it('rejects stale moves and cursors after concurrent changes', async () => {
    const store = new ItemStore(50);
    for (let i = 1; i <= 30; i++) store.select(String(i), true);
    const page = await store.list({ side: 'selected', query: '' });
    for (let i = 1; i <= 25; i++) store.select(String(i), false);
    await expect(store.list({ side: 'selected', query: '', cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(() => store.move({ id: '26', targetId: '27', placement: 'after', revision: page.revision })).toThrow('Список изменился');
  });

  it('invalidates old cursors across process instances', async () => {
    const first = new ItemStore(50);
    const page = await first.list({ side: 'available', query: '' });
    const restarted = new ItemStore(50);
    await expect(restarted.list({ side: 'available', query: '', cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });

  it('rejects malformed cursors and cursors for a different filter', async () => {
    const store = new ItemStore(50);
    const page = await store.list({ side: 'available', query: '' });
    await expect(store.list({ side: 'available', query: '', cursor: 'bad' })).rejects.toMatchObject({ status: 400 });
    await expect(store.list({ side: 'available', query: '1', cursor: page.nextCursor! })).rejects.toMatchObject({ status: 400 });
  });

  it('invalidates cached pages on changes', async () => {
    const store = new ItemStore(10);
    const first = await store.list({ side: 'available', query: '' });
    expect(await store.list({ side: 'available', query: '' })).toBe(first);
    store.select('1', true);
    expect((await store.list({ side: 'available', query: '' })).items).not.toContain('1');
  });
});
