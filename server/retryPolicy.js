// Retry logic with exponential backoff
class RetryPolicy {
  constructor(maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 10000) {
    this.maxRetries = maxRetries;
    this.initialDelayMs = initialDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  async execute(fn, context = 'operation') {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          const delay = this.calculateBackoff(attempt);
          await this.sleep(delay);
        }
      }
    }
    
    const error = new Error(`${context} failed after ${this.maxRetries + 1} attempts`);
    error.originalError = lastError;
    throw error;
  }

  calculateBackoff(attempt) {
    // Exponential backoff: initialDelay * 2^attempt
    // With jitter: ±10%
    const exponentialDelay = this.initialDelayMs * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
    const jitter = cappedDelay * 0.1 * (Math.random() - 0.5);
    return cappedDelay + jitter;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RetryPolicy;
