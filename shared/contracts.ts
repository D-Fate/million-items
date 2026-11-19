export const PAGE_SIZE = 20;
export const MAX_ID_LENGTH = 128;

export type ListSide = 'available' | 'selected';

export interface ListQuery {
  side: ListSide;
  query: string;
  cursor?: string;
}

export interface Totals {
  all: number;
  selected: number;
}

export interface ItemPage {
  items: string[];
  nextCursor: string | null;
  revision: string;
  totals: Totals;
}

export interface MutationResult {
  revision: string;
  totals: Totals;
}

export interface MoveItem {
  id: string;
  targetId: string;
  placement: 'before' | 'after';
  revision: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
