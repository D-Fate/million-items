import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchScheduler } from '../../server/src/scheduler.js';

describe('BatchScheduler', () => {
  let scheduler: BatchScheduler;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    scheduler = new BatchScheduler();
  });
  afterEach(() => { scheduler.close(); vi.useRealTimers(); });

  it('runs regular requests at one-second boundaries', async () => {
    const run = vi.fn(() => 42);
    const result = scheduler.enqueue('read', run);
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(42);
    expect(run).toHaveBeenCalledOnce();
  });

  it('holds additions until the ten-second batch and coalesces duplicate IDs', async () => {
    const run = vi.fn(() => 'created');
    const results = Array.from({ length: 100 }, () => scheduler.add('same-id', run));
    await vi.advanceTimersByTimeAsync(9999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.all(results)).toHaveLength(100);
    expect(run).toHaveBeenCalledOnce();
  });

  it('deduplicates reads within the same mutation boundary', async () => {
    const run = vi.fn(() => 1);
    const results = Array.from({ length: 50 }, () => scheduler.enqueue('same-query', run));
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(results);
    expect(run).toHaveBeenCalledOnce();
  });

  it('does not deduplicate reads or opposite mutations across a write', async () => {
    let selected = false;
    const before = scheduler.enqueue('read', () => selected);
    const first = scheduler.enqueue('select', () => { selected = true; }, true);
    const middle = scheduler.enqueue('read', () => selected);
    const second = scheduler.enqueue('deselect', () => { selected = false; }, true);
    const third = scheduler.enqueue('select', () => { selected = true; }, true);
    const after = scheduler.enqueue('read', () => selected);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([first, second, third]);
    expect(await before).toBe(false);
    expect(await middle).toBe(true);
    expect(await after).toBe(true);
  });

  it('continues processing after an operation fails', async () => {
    const failure = scheduler.enqueue('fail', () => { throw new Error('failure'); }).catch(error => error);
    const success = scheduler.enqueue('success', () => 2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await failure).toBeInstanceOf(Error);
    expect(await success).toBe(2);
  });

  it('applies backpressure to unique operations while accepting duplicates', async () => {
    scheduler.close();
    scheduler = new BatchScheduler({ queueLimit: 1 });
    const first = scheduler.enqueue('a', () => 1);
    const duplicate = scheduler.enqueue('a', () => 1);
    await expect(scheduler.enqueue('b', () => 2)).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await Promise.all([first, duplicate])).toEqual([1, 1]);
  });

  it('limits the batch size and preserves the remaining FIFO order', async () => {
    scheduler.close();
    scheduler = new BatchScheduler({ batchLimit: 1 });
    const run = vi.fn(() => 2);
    const first = scheduler.enqueue('a', () => 1);
    const second = scheduler.enqueue('b', run);
    await vi.advanceTimersByTimeAsync(1000);
    await first;
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBe(2);
  });

  it('rejects pending and new operations during shutdown', async () => {
    const first = scheduler.enqueue('a', () => 1).catch(error => error);
    scheduler.close();
    expect(await first).toMatchObject({ status: 503 });
    await expect(scheduler.add('b', () => 2)).rejects.toMatchObject({ status: 503 });
  });

  it('never overlaps mutations with an asynchronous read, even across timer ticks', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = scheduler.enqueue('slow-read', () => gate);
    const write = vi.fn(() => 'created');
    const result = scheduler.add('new', write);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(write).not.toHaveBeenCalled();
    release();
    await read;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe('created');
  });

  it('expires a queued operation without applying it', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = scheduler.enqueue('slow-read', () => gate);
    const write = vi.fn();
    const expired = scheduler.enqueue('write', write, true).catch(error => error);
    await vi.advanceTimersByTimeAsync(31_000);
    release();
    await read;
    expect(await expired).toMatchObject({ code: 'QUEUE_TIMEOUT' });
    expect(write).not.toHaveBeenCalled();
  });
});
