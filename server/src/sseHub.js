/**
 * SSE hub: broadcast file-system events to subscribed browser clients.
 *
 * Uses a simple subscriber list; each subscriber receives events
 * synchronously during emit.  The HTTP handler (in app.js) is
 * responsible for setting SSE headers and flushing.
 */
class SseHub {
  constructor() {
    /** @type {Set<(event: SseEvent) => void>} */
    this._listeners = new Set();
  }

  /**
   * Subscribe a listener function.  Returns an unsubscribe callback.
   * @param {(event: SseEvent) => void} fn
   * @returns {() => void}
   */
  subscribe(fn) {
    this._listeners.add(fn);
    return () => { this._listeners.delete(fn); };
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} type — action type (upload, trash, restore, copy, move, rename, empty)
   * @param {object} [payload] — optional extra data
   */
  emit(type, payload = {}) {
    const event = {
      event: type,
      data: JSON.stringify(payload),
      timestamp: Date.now(),
    };
    for (const fn of this._listeners) {
      try { fn(event); } catch { /* one listener failing must not break others */ }
    }
  }
}

module.exports = { SseHub };