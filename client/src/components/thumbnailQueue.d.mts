// TypeScript declarations for thumbnailQueue.mjs

export interface QueueHandle {
  enqueue(task: (release: () => void) => void): { cancel: () => void };
}

export function createQueue(maxConcurrent?: number): QueueHandle;