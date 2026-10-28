// ── thumbnail-queue.test.mjs ──
// Deterministic tests for the bounded-concurrency thumbnail queue.
// Run: node --test client/test/thumbnail-queue.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createQueue } from '../src/components/thumbnailQueue.mjs';

describe('createQueue', () => {
  it('throws on invalid maxConcurrent', () => {
    assert.throws(() => createQueue(0), RangeError);
    assert.throws(() => createQueue(-1), RangeError);
    assert.throws(() => createQueue(NaN), RangeError);
  });

  it('runs at most maxConcurrent tasks simultaneously', async () => {
    const q = createQueue(2);
    let concurrent = 0;
    let maxSeen = 0;
    const results = [];

    for (let i = 0; i < 5; i++) {
      q.enqueue((release) => {
        concurrent++;
        if (concurrent > maxSeen) maxSeen = concurrent;
        setTimeout(() => {
          concurrent--;
          results.push(i);
          release();
        }, 50);
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(maxSeen, 2, 'should never exceed maxConcurrent');
    assert.deepStrictEqual(results.sort(), [0, 1, 2, 3, 4], 'all tasks should complete');
  });

  it('cancels a queued job — cancelled job never runs', async () => {
    const q = createQueue(1);
    const ran = [];

    const first = q.enqueue((release) => {
      setTimeout(() => { release(); }, 30);
    });

    const second = q.enqueue((release) => {
      ran.push(2);
      setTimeout(() => { release(); }, 10);
    });

    // Cancel the second (queued) job immediately.
    second.cancel();

    // Wait for first to complete and pump the queue.
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(ran.length, 0, 'cancelled job should not run');
  });

  it('release after cancel is a no-op', async () => {
    const q = createQueue(1);
    let ran = false;

    const first = q.enqueue((release) => {
      setTimeout(() => { release(); }, 20);
    });

    const second = q.enqueue((release) => {
      ran = true;
      release();
    });

    // Cancel the queued job.
    second.cancel();

    // Release should not cause the cancelled task to run.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(ran, false, 'released-after-cancel should not run task');
  });

  it('pumps later jobs after every completion', async () => {
    const q = createQueue(1);
    const order = [];

    // Job 0 starts immediately.
    q.enqueue((release) => {
      setTimeout(() => {
        order.push(0);
        release();
      }, 30);
    });

    // Job 1 waits.
    q.enqueue((release) => {
      setTimeout(() => {
        order.push(1);
        release();
      }, 20);
    });

    // Job 2 waits.
    q.enqueue((release) => {
      setTimeout(() => {
        order.push(2);
        release();
      }, 10);
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepStrictEqual(order, [0, 1, 2]);
  });

  it('skips cancelled entries when draining', async () => {
    const q = createQueue(1);
    const order = [];

    // Job 0 starts immediately.
    q.enqueue((release) => {
      setTimeout(() => {
        order.push(0);
        release();
      }, 30);
    });

    // Jobs 1 and 2 are queued. Cancel job 1.
    const j1 = q.enqueue((release) => {
      order.push(1);
      setTimeout(() => { release(); }, 10);
    });
    j1.cancel();

    // Job 2 should still run after job 0.
    q.enqueue((release) => {
      order.push(2);
      setTimeout(() => { release(); }, 10);
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepStrictEqual(order, [0, 2]);
  });

  it('handles multiple cancellations correctly', async () => {
    const q = createQueue(1);
    const order = [];

    q.enqueue((release) => {
      setTimeout(() => { release(); }, 20);
    });

    const j1 = q.enqueue((release) => {
      order.push(1);
      release();
    });
    j1.cancel();

    const j2 = q.enqueue((release) => {
      order.push(2);
      release();
    });
    j2.cancel();

    q.enqueue((release) => {
      order.push(3);
      release();
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepStrictEqual(order, [3]);
  });

  it('frees the slot when a running job is cancelled', async () => {
    const q = createQueue(1);
    const ran = [];

    // Job 0 starts and never releases: it is cancelled while running.
    const running = q.enqueue(() => {
      ran.push(0);
    });
    running.cancel();

    q.enqueue((release) => {
      ran.push(1);
      release();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepStrictEqual(ran, [0, 1], 'cancelled running job must free its slot');
  });

  it('does not over-admit when a cancelled running job releases later', () => {
    const q = createQueue(3);
    const started = [];
    /** @type {Map<string, () => void>} */
    const releases = new Map();
    /** @type {Map<string, () => void>} */
    const cancels = new Map();

    const add = (name) => {
      cancels.set(name, q.enqueue((release) => {
        started.push(name);
        releases.set(name, release);
      }).cancel);
    };

    add('A');
    add('B');
    add('C');
    assert.deepStrictEqual(started, ['A', 'B', 'C'], 'three jobs fill the pool');

    // A is cancelled while running: its slot is freed immediately.
    cancels.get('A')();

    add('D');
    assert.deepStrictEqual(started, ['A', 'B', 'C', 'D'], 'D takes the freed slot');

    // The cancelled job settles late and calls release for real. That must not
    // free a second slot.
    releases.get('A')();
    add('E');
    assert.deepStrictEqual(started, ['A', 'B', 'C', 'D'], 'E must stay queued');

    releases.get('B')();
    assert.deepStrictEqual(started, ['A', 'B', 'C', 'D', 'E'], 'E starts on the real release');
  });

  it('handles sync errors without leaking slots', async () => {
    const q = createQueue(1);
    let ran = false;

    // First task blocks the slot.
    q.enqueue((release) => {
      setTimeout(() => { release(); }, 50);
    });

    // Second task throws synchronously.
    const j2 = q.enqueue((release) => {
      ran = true;
      throw new Error('boom');
    });

    // Cancel the thrower — should not affect slot.
    j2.cancel();

    // Third task should still run after first completes.
    q.enqueue((release) => {
      ran = false;
      setTimeout(() => {
        ran = true;
        release();
      }, 30);
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(ran, 'third task should run after first completes');
  });
});