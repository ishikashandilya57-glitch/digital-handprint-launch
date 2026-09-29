(function (root, factory) {
  const HoldController = factory();
  if (typeof module === 'object' && module.exports) module.exports = HoldController;
  else root.HoldController = HoldController;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return class HoldController {
    constructor({ duration = 1500, onProgress = () => {}, onComplete = () => {}, now = () => performance.now(), schedule = requestAnimationFrame, cancel = cancelAnimationFrame }) {
      this.duration = duration;
      this.onProgress = onProgress;
      this.onComplete = onComplete;
      this.now = now;
      this.schedule = schedule;
      this.cancel = cancel;
      this.active = false;
      this.completed = false;
    }
    start() {
      if (this.active || this.completed) return;
      this.active = true;
      this.startedAt = this.now();
      const tick = () => {
        if (!this.active) return;
        const progress = Math.min((this.now() - this.startedAt) / this.duration, 1);
        this.onProgress(progress);
        if (progress >= 1) {
          this.active = false;
          this.completed = true;
          this.onComplete();
        } else this.frame = this.schedule(tick);
      };
      tick();
    }
    stop() {
      if (!this.active || this.completed) return;
      this.active = false;
      if (this.frame != null) this.cancel(this.frame);
      this.onProgress(0);
    }
    reset() {
      this.active = false;
      this.completed = false;
      if (this.frame != null) this.cancel(this.frame);
      this.onProgress(0);
    }
  };
});
