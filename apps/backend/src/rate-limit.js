/**
 * In-memory spend guard.
 *
 * This is not a security control — it is a backstop so that a bug, a stuck
 * retry loop, or a leaked token cannot quietly mail hundreds of letters at
 * roughly a dollar each. A single Railway instance makes an in-memory counter
 * sufficient; if the service is ever scaled out, move this to Redis.
 */
export class LetterRateLimiter {
  constructor({ maxPerHour, maxPerDay, now = () => Date.now() }) {
    this.maxPerHour = maxPerHour;
    this.maxPerDay = maxPerDay;
    this.now = now;
    /** @type {number[]} timestamps, one per letter sent */
    this.sent = [];
  }

  prune() {
    const cutoff = this.now() - 24 * 60 * 60 * 1000;
    this.sent = this.sent.filter((timestamp) => timestamp > cutoff);
  }

  countSince(windowMs) {
    const cutoff = this.now() - windowMs;
    return this.sent.filter((timestamp) => timestamp > cutoff).length;
  }

  /**
   * @param {number} count how many letters this request would mail
   * @returns {{allowed: boolean, reason?: string}}
   */
  check(count) {
    this.prune();
    const hour = this.countSince(60 * 60 * 1000);
    const day = this.sent.length;
    if (hour + count > this.maxPerHour) {
      return {
        allowed: false,
        reason: `Hourly limit reached (${this.maxPerHour} letters/hour). ${hour} already sent this hour.`,
      };
    }
    if (day + count > this.maxPerDay) {
      return {
        allowed: false,
        reason: `Daily limit reached (${this.maxPerDay} letters/day). ${day} already sent today.`,
      };
    }
    return { allowed: true };
  }

  record(count = 1) {
    const timestamp = this.now();
    for (let i = 0; i < count; i += 1) this.sent.push(timestamp);
  }
}
