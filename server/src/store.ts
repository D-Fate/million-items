import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { PAGE_SIZE, type ItemPage, type ListQuery, type MoveItem, type MutationResult } from '../../shared/contracts.js';
import { AppError, invalid } from './errors.js';

interface Cursor {
  revision: string;
  side: string;
  query: string;
  index: number;
}

export class ItemStore {
  private readonly customIds: string[] = [];
  private readonly customSet = new Set<string>();
  private readonly selectedSet = new Set<string>();
  private readonly selectedIds: string[] = [];
  private readonly instanceId = randomUUID();
  private version = 0;
  private readonly pageCache = new Map<string, ItemPage>();

  constructor(private readonly initialCount = 1_000_000) {}

  get revision(): string {
    return `${this.instanceId}:${this.version}`;
  }

  state(): MutationResult {
    return {
      revision: this.revision,
      totals: { all: this.initialCount + this.customIds.length, selected: this.selectedIds.length },
    };
  }

  exists(id: string): boolean {
    const number = Number(id);
    return (Number.isInteger(number) && number >= 1 && number <= this.initialCount && String(number) === id)
      || this.customSet.has(id);
  }

  add(id: string): MutationResult {
    if (this.exists(id)) throw new AppError(409, 'ID_EXISTS', 'Элемент с таким ID уже существует.');
    this.customSet.add(id);
    this.customIds.push(id);
    this.changed();
    return this.state();
  }

  select(id: string, selected: boolean): MutationResult {
    if (!this.exists(id)) throw new AppError(404, 'NOT_FOUND', 'Элемент не найден.');
    if (this.selectedSet.has(id) === selected) return this.state();
    if (selected) {
      this.selectedSet.add(id);
      this.selectedIds.push(id);
    } else {
      this.selectedSet.delete(id);
      this.selectedIds.splice(this.selectedIds.indexOf(id), 1);
    }
    this.changed();
    return this.state();
  }

  move(command: MoveItem): MutationResult {
    this.assertRevision(command.revision);
    const from = this.selectedIds.indexOf(command.id);
    const target = this.selectedIds.indexOf(command.targetId);
    if (from < 0 || target < 0) throw new AppError(404, 'NOT_SELECTED', 'Элемент больше не выбран.');
    if (from === target) return this.state();
    this.selectedIds.splice(from, 1);
    const index = this.selectedIds.indexOf(command.targetId);
    this.selectedIds.splice(index + (command.placement === 'after' ? 1 : 0), 0, command.id);
    this.changed();
    return this.state();
  }

  async list(request: ListQuery): Promise<ItemPage> {
    const start = this.readCursor(request);
    const cacheKey = JSON.stringify([request.side, request.query, start]);
    const cached = this.pageCache.get(cacheKey);
    if (cached) {
      this.pageCache.delete(cacheKey);
      this.pageCache.set(cacheKey, cached);
      return cached;
    }

    const items: string[] = [];
    const size = request.side === 'selected' ? this.selectedIds.length : this.initialCount + this.customIds.length;
    let index = start;
    let nextIndex: number | null = null;

    for (; index < size; index++) {
      if (index > start && (index - start) % 10_000 === 0) await setImmediate();
      const id = request.side === 'selected'
        ? this.selectedIds[index]!
        : index < this.initialCount ? String(index + 1) : this.customIds[index - this.initialCount]!;
      if (request.side === 'available' && this.selectedSet.has(id)) continue;
      if (!id.includes(request.query)) continue;
      if (items.length === PAGE_SIZE) {
        nextIndex = index;
        break;
      }
      items.push(id);
    }

    const page: ItemPage = {
      items,
      nextCursor: nextIndex === null ? null : Buffer.from(JSON.stringify({
        revision: this.revision, side: request.side, query: request.query, index: nextIndex,
      } satisfies Cursor)).toString('base64url'),
      ...this.state(),
    };
    if (this.pageCache.size >= 200) this.pageCache.delete(this.pageCache.keys().next().value!);
    this.pageCache.set(cacheKey, page);
    return page;
  }

  private readCursor(request: ListQuery): number {
    if (!request.cursor) return 0;
    let cursor: Cursor;
    try {
      cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8')) as Cursor;
    } catch {
      invalid('Некорректный курсор.');
    }
    const size = request.side === 'selected' ? this.selectedIds.length : this.initialCount + this.customIds.length;
    if (!cursor || cursor.side !== request.side || cursor.query !== request.query
      || typeof cursor.revision !== 'string' || !Number.isSafeInteger(cursor.index) || cursor.index < 0) {
      invalid('Курсор не соответствует запросу.');
    }
    this.assertRevision(cursor.revision);
    if (cursor.index > size) invalid('Курсор выходит за границы списка.');
    return cursor.index;
  }

  private assertRevision(revision: string): void {
    if (revision !== this.revision) {
      throw new AppError(409, 'STALE_REVISION', 'Список изменился. Обновите данные и повторите действие.');
    }
  }

  private changed(): void {
    this.version++;
    this.pageCache.clear();
  }
}
