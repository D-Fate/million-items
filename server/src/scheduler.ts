import { setImmediate } from 'node:timers/promises';
import { AppError } from './errors.js';

interface Job {
  key: string;
  run: () => unknown | Promise<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  expiresAt: number;
}

class Queue {
  private jobs: Job[] = [];
  private readonly duplicates = new Map<string, Job>();
  private lastKey: string | undefined;

  constructor(private readonly limit: number) {}

  get size(): number { return this.jobs.length; }

  add<T>(key: string, run: () => T | Promise<T>, barrier: boolean, ttl: number): Promise<T> {
    // A mutation separates read snapshots and opposite updates to the same ID.
    if (barrier && this.lastKey !== key) this.duplicates.clear();
    const existing = this.duplicates.get(key);
    if (existing) return existing.promise as Promise<T>;
    if (this.jobs.length >= this.limit) {
      return Promise.reject(new AppError(429, 'QUEUE_FULL', 'Очередь заполнена. Повторите запрос позже.'));
    }
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
    const job: Job = { key, run, promise, resolve, reject, expiresAt: Date.now() + ttl };
    this.jobs.push(job);
    this.duplicates.set(key, job);
    this.lastKey = key;
    return promise as Promise<T>;
  }

  take(limit: number): Job[] {
    const batch = this.jobs.splice(0, limit);
    for (const job of batch) {
      if (this.duplicates.get(job.key) === job) this.duplicates.delete(job.key);
    }
    if (!this.jobs.length) this.lastKey = undefined;
    return batch;
  }

  close(): void {
    for (const job of this.take(this.jobs.length)) {
      job.reject(new AppError(503, 'SHUTTING_DOWN', 'Сервер останавливается.'));
    }
  }
}

export interface SchedulerOptions {
  readIntervalMs?: number;
  addIntervalMs?: number;
  queueLimit?: number;
  batchLimit?: number;
}

export class BatchScheduler {
  private readonly regular: Queue;
  private readonly additions: Queue;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly addInterval: number;
  private readonly batchLimit: number;
  private lastAdditionBatch = Date.now();
  private running = false;
  private closed = false;

  constructor(options: SchedulerOptions = {}) {
    this.regular = new Queue(options.queueLimit ?? 1000);
    this.additions = new Queue(options.queueLimit ?? 1000);
    this.addInterval = options.addIntervalMs ?? 10_000;
    this.batchLimit = options.batchLimit ?? 200;
    this.timer = setInterval(() => { void this.flush(); }, options.readIntervalMs ?? 1000);
    this.timer.unref();
  }

  enqueue<T>(key: string, run: () => T | Promise<T>, mutation = false): Promise<T> {
    if (this.closed) return Promise.reject(new AppError(503, 'SHUTTING_DOWN', 'Сервер останавливается.'));
    return this.regular.add(key, run, mutation, 30_000);
  }

  add<T>(id: string, run: () => T): Promise<T> {
    if (this.closed) return Promise.reject(new AppError(503, 'SHUTTING_DOWN', 'Сервер останавливается.'));
    return this.additions.add(id, run, false, 60_000);
  }

  stats(): { regular: number; additions: number; processing: boolean } {
    return { regular: this.regular.size, additions: this.additions.size, processing: this.running };
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    this.regular.close();
    this.additions.close();
  }

  private async flush(): Promise<void> {
    if (this.running || this.closed) return;
    this.running = true;
    const additionsDue = Date.now() - this.lastAdditionBatch >= this.addInterval;
    const batch = additionsDue ? this.additions.take(this.batchLimit) : [];
    if (additionsDue) this.lastAdditionBatch = Date.now();
    batch.push(...this.regular.take(this.batchLimit));
    try {
      for (const job of batch) {
        try {
          if (this.closed) throw new AppError(503, 'SHUTTING_DOWN', 'Сервер останавливается.');
          if (Date.now() > job.expiresAt) throw new AppError(503, 'QUEUE_TIMEOUT', 'Время ожидания в очереди истекло.');
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        }
        await setImmediate();
      }
    } finally {
      this.running = false;
    }
  }
}
