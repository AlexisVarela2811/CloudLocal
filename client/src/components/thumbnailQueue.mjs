// ── thumbnailQueue.mjs ──
// Bounded-concurrency queue used by FileVisual.
// Pure module: no React and no DOM, so it can be tested in Node.
//
// API:
//   const queue = createQueue(max);        // default max = 3
//   const { cancel } = queue.enqueue(task);
//   The task receives release(); it must be called exactly once when the job
//   reaches any terminal state (success, failure, timeout or abort).
//
// Guarantees:
//   - At most `max` tasks run simultaneously.
//   - Cancelling a queued job removes it and it never runs.
//   - Cancelling a running job frees its slot immediately, so queued jobs are
//     not blocked by work that is being thrown away.
//   - release() after cancel is a no-op: a cancelled job can never free the
//     same slot twice (which would over-admit work).

export function createQueue(maxConcurrent = 3) {
  if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError('createQueue: maxConcurrent must be ≥ 1');
  }

  let active = 0;
  /** @type {Array<{task: (release: () => void) => void, state: 'queued'|'running'|'done'|'cancelled'}>} */
  const pending = [];

  function pump() {
    while (active < maxConcurrent && pending.length > 0) {
      const entry = pending.shift();
      if (!entry || entry.state !== 'queued') continue;

      entry.state = 'running';
      active++;

      const release = () => {
        // A cancelled running job already gave its slot back.
        if (entry.state !== 'running') return;
        entry.state = 'done';
        active--;
        pump();
      };

      try {
        entry.task(release);
      } catch (err) {
        // A task that throws synchronously counts as finished.
        release();
        throw err;
      }
    }
  }

  /**
   * Enqueue a task. Returns its cancellation handle.
   * @param {(release: () => void) => void} task
   * @returns {{ cancel: () => void }}
   */
  function enqueue(task) {
    const entry = { task, state: 'queued' };
    pending.push(entry);

    function cancel() {
      if (entry.state === 'queued') {
        entry.state = 'cancelled';
        const idx = pending.indexOf(entry);
        if (idx !== -1) pending.splice(idx, 1);
        return;
      }
      if (entry.state === 'running') {
        // The work itself is aborted by the caller; free the slot right away.
        entry.state = 'cancelled';
        active--;
        pump();
      }
    }

    pump();

    return { cancel };
  }

  return { enqueue };
}
