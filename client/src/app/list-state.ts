import { signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import type { ListSide, Totals } from '../../../shared/contracts';
import { ApiService, errorCode, errorMessage } from './api.service';

export class ListState {
  readonly items = signal<string[]>([]);
  readonly filter = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly nextCursor = signal<string | null>(null);
  readonly revision = signal('');
  private request?: Subscription;
  private debounce?: ReturnType<typeof setTimeout>;
  private staleRetries = 0;

  constructor(
    readonly side: ListSide,
    private readonly api: ApiService,
    private readonly onTotals: (totals: Totals) => void,
    private readonly onStale: () => void,
  ) {}

  setFilter(value: string): void {
    this.filter.set(value);
    this.request?.unsubscribe();
    clearTimeout(this.debounce);
    this.items.set([]);
    this.nextCursor.set(null);
    this.loading.set(true);
    this.error.set('');
    this.debounce = setTimeout(() => this.reload(), 300);
  }

  reload(): void {
    clearTimeout(this.debounce);
    this.request?.unsubscribe();
    this.items.set([]);
    this.nextCursor.set(null);
    this.staleRetries = 0;
    this.fetch();
  }

  loadMore(): void {
    if (this.loading() || !this.nextCursor()) return;
    this.fetch(this.nextCursor()!);
  }

  retry(): void {
    if (this.nextCursor()) this.loadMore();
    else this.reload();
  }

  destroy(): void {
    clearTimeout(this.debounce);
    this.request?.unsubscribe();
  }

  private fetch(cursor?: string): void {
    this.loading.set(true);
    this.error.set('');
    this.request = this.api.list({ side: this.side, query: this.filter(), cursor }).subscribe({
      next: page => {
        this.items.update(items => cursor ? [...items, ...page.items] : page.items);
        this.nextCursor.set(page.nextCursor);
        this.revision.set(page.revision);
        this.onTotals(page.totals);
        this.loading.set(false);
        this.staleRetries = 0;
      },
      error: error => {
        this.loading.set(false);
        if (errorCode(error) === 'STALE_REVISION' && this.staleRetries < 1) {
          this.staleRetries++;
          this.items.set([]);
          this.nextCursor.set(null);
          this.onStale();
          this.fetch();
          return;
        }
        this.error.set(errorMessage(error));
      },
    });
  }
}
