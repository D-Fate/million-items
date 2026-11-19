import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { IconComponent } from './icon.component';
import { ListState } from './list-state';

export interface ReorderEvent { id: string; targetId: string; placement: 'before' | 'after'; }

@Component({
  selector: 'app-list-panel',
  imports: [DecimalPipe, IconComponent, CdkDrag, CdkDragHandle, CdkDropList, CdkScrollable],
  templateUrl: './list-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListPanelComponent {
  readonly state = input.required<ListState>();
  readonly count = input.required<number>();
  readonly busy = input(false);
  readonly choose = output<string>();
  readonly reorder = output<ReorderEvent>();
  readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');

  constructor() {
    effect(() => {
      const state = this.state();
      state.filter();
      if (state.items().length === 0) this.viewport()?.nativeElement.scrollTo({ top: 0 });
    });
  }

  onScroll(): void {
    const element = this.viewport()?.nativeElement;
    if (element && !this.state().error() && element.scrollHeight - element.scrollTop - element.clientHeight < 140) {
      this.state().loadMore();
    }
  }

  drop(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const items = this.state().items();
    const id = items[event.previousIndex];
    const targetId = items[event.currentIndex];
    if (id && targetId) this.reorder.emit({ id, targetId, placement: event.previousIndex < event.currentIndex ? 'after' : 'before' });
  }

  move(index: number, delta: number): void {
    const items = this.state().items();
    const id = items[index];
    const targetId = items[index + delta];
    if (id && targetId) this.reorder.emit({ id, targetId, placement: delta > 0 ? 'after' : 'before' });
  }
}
