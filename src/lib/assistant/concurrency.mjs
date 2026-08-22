export class ConcurrencyLimitExceeded extends Error {
  constructor() {
    super("assistant concurrency limit reached");
    this.name = "ConcurrencyLimitExceeded";
  }
}

export class ConcurrencySemaphore {
  #active = 0;

  constructor(limit) {
    this.setLimit(limit);
  }

  setLimit(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid assistant concurrency limit");
    this.limit = limit;
  }

  get active() {
    return this.#active;
  }

  acquire() {
    if (this.#active >= this.limit) return null;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}

export async function withConcurrencySlot(semaphore, work) {
  const release = semaphore.acquire();
  if (!release) throw new ConcurrencyLimitExceeded();
  try {
    return await work();
  } finally {
    release();
  }
}
