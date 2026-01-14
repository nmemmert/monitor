// Circuit breaker implementation for API resilience
class CircuitBreaker {
  constructor(failureThreshold = 5, resetTimeout = 60000, errorFilter = null) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.errorFilter = errorFilter;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'closed'; // closed, open, half-open
  }

  async execute(fn, fallback = null) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        if (fallback) return fallback();
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.close();
      }
      return result;
    } catch (error) {
      if (this.errorFilter && !this.errorFilter(error)) {
        throw error;
      }

      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.failureThreshold) {
        this.open();
      }

      throw error;
    }
  }

  close() {
    this.failureCount = 0;
    this.state = 'closed';
  }

  open() {
    this.state = 'open';
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}

module.exports = CircuitBreaker;
