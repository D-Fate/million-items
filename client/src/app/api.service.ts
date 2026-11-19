import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { timeout } from 'rxjs';
import type { ApiErrorBody, ItemPage, ListQuery, MoveItem, MutationResult } from '../../../shared/contracts';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  list(query: ListQuery) {
    const params: Record<string, string> = { side: query.side, q: query.query };
    if (query.cursor) params['cursor'] = query.cursor;
    return this.http.get<ItemPage>('/api/items', { params }).pipe(timeout(70_000));
  }

  add(id: string) {
    return this.http.post<MutationResult>('/api/items', { id }).pipe(timeout(70_000));
  }

  select(id: string, selected: boolean) {
    return this.http.put<MutationResult>('/api/selection', { id, selected }).pipe(timeout(70_000));
  }

  move(command: MoveItem) {
    return this.http.post<MutationResult>('/api/selection/move', command).pipe(timeout(70_000));
  }
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof HttpErrorResponse ? (error.error as ApiErrorBody | undefined)?.error?.code : undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as ApiErrorBody | undefined)?.error?.message;
    if (message) return message;
  }
  return 'Нет ответа от сервера. Обновите списки, чтобы проверить состояние операции.';
}
