import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="paths[name()]" /></svg>`,
  styles: [':host { display: inline-flex; width: 20px; height: 20px; flex: 0 0 auto; } svg { width: 100%; height: 100%; }'],
})
export class IconComponent {
  readonly name = input.required<'grid' | 'search' | 'plus' | 'arrow' | 'close' | 'grip' | 'up' | 'down' | 'refresh' | 'check' | 'stack'>();
  readonly paths = {
    grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
    search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    plus: 'M12 5v14 M5 12h14',
    arrow: 'M4 12h16 M14 6l6 6-6 6',
    close: 'M6 6l12 12 M18 6 6 18',
    grip: 'M9 5h.01 M15 5h.01 M9 12h.01 M15 12h.01 M9 19h.01 M15 19h.01',
    up: 'm6 14 6-6 6 6',
    down: 'm6 10 6 6 6-6',
    refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 14 6 M4 12a8 8 0 0 0 14 6',
    check: 'm5 12 4 4L19 6',
    stack: 'm12 3 9 5-9 5-9-5 9-5 M3 12l9 5 9-5 M3 16l9 5 9-5',
  };
}
