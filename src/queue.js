// src/queue.js
// Simple async FIFO queue for sequential processing of AI pipeline jobs

class AsyncQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  // jobFn should be an async function
  enqueue(jobFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ jobFn, resolve, reject });
      this.processNext();
    });
  }

  async processNext() {
    if (this.processing) return;
    if (this.queue.length === 0) return;
    this.processing = true;
    const { jobFn, resolve, reject } = this.queue.shift();
    try {
      const result = await jobFn();
      resolve(result);
    } catch (err) {
      reject(err);
    }
    this.processing = false;
    // Process the next job in the queue
    setImmediate(() => this.processNext());
  }
}

const aiJobQueue = new AsyncQueue();
export default aiJobQueue;
