import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import type { MutationResult, Totals } from '../../../shared/contracts';
import { ApiService, errorCode, errorMessage } from './api.service';
import { IconComponent } from './icon.component';
import { ListPanelComponent, type ReorderEvent } from './list-panel.component';
import { ListState } from './list-state';

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, FormsModule, IconComponent, ListPanelComponent],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly totals = signal<Totals>({ all: 1_000_000, selected: 0 });
  readonly saving = signal(false);
  readonly adding = signal(false);
  readonly notice = signal<{ text: string; error: boolean } | null>(null);
  readonly addError = signal('');
  newId = '';

  readonly available = this.makeList('available');
  readonly selected = this.makeList('selected');

  constructor() {
    this.refresh();
    this.destroyRef.onDestroy(() => { this.available.destroy(); this.selected.destroy(); });
  }

  refresh(): void {
    this.available.reload();
    this.selected.reload();
  }

  choose(id: string, selected: boolean): void {
    this.mutate(this.api.select(id, selected), selected ? `Элемент ${id} выбран.` : `Элемент ${id} возвращён в общий список.`);
  }

  reorder(event: ReorderEvent): void {
    this.mutate(this.api.move({ ...event, revision: this.selected.revision() }), 'Порядок сохранён.');
  }

  add(): void {
    const id = this.newId.trim();
    if (!id || this.adding()) return;
    this.adding.set(true);
    this.addError.set('');
    this.api.add(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.adding.set(false);
        this.newId = '';
        this.totals.set(result.totals);
        this.available.setFilter(id);
        this.selected.reload();
        this.notice.set({ text: `Элемент ${id} добавлен. В левом списке включён поиск по этому ID.`, error: false });
      },
      error: error => { this.adding.set(false); this.addError.set(errorMessage(error)); },
    });
  }

  private makeList(side: 'available' | 'selected'): ListState {
    return new ListState(side, this.api, totals => this.totals.set(totals), () => {
      this.notice.set({ text: 'Данные изменились в другой вкладке. Список обновлён.', error: false });
    });
  }

  private mutate(request: Observable<MutationResult>, message: string): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.notice.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.saving.set(false);
        this.totals.set(result.totals);
        this.notice.set({ text: message, error: false });
        this.refresh();
      },
      error: error => {
        this.saving.set(false);
        this.notice.set({ text: errorMessage(error), error: true });
        if (errorCode(error) === 'STALE_REVISION' || errorCode(error) === 'NOT_SELECTED') this.refresh();
      },
    });
  }
}
