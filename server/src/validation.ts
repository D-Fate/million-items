import { MAX_ID_LENGTH, type ListQuery, type MoveItem } from '../../shared/contracts.js';
import { invalid } from './errors.js';

export function parseId(value: unknown): string {
  if (typeof value !== 'string') invalid('ID должен быть строкой.');
  const id = value.trim();
  if (!id || id.length > MAX_ID_LENGTH || /[\p{Cc}\p{Cs}]/u.test(id)) {
    invalid(`ID должен содержать от 1 до ${MAX_ID_LENGTH} символов без управляющих знаков.`);
  }
  return id;
}

export function parseListQuery(input: Record<string, unknown>): ListQuery {
  if (input['side'] !== 'available' && input['side'] !== 'selected') invalid('Неизвестный список.');
  const query = input['q'] ?? '';
  if (typeof query !== 'string' || query.length > MAX_ID_LENGTH) invalid('Некорректный фильтр.');
  const cursor = input['cursor'];
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 1024)) {
    invalid('Некорректный курсор.');
  }
  return { side: input['side'], query: query.trim(), cursor };
}

export function parseMove(input: unknown): MoveItem {
  const body = parseBody(input);
  if (body['placement'] !== 'before' && body['placement'] !== 'after') invalid('Некорректная позиция.');
  if (typeof body['revision'] !== 'string' || body['revision'].length > 80) invalid('Не указана версия списка.');
  return {
    id: parseId(body['id']),
    targetId: parseId(body['targetId']),
    placement: body['placement'],
    revision: body['revision'],
  };
}

export function parseBody(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Ожидается JSON-объект.');
  return input as Record<string, unknown>;
}
