// Observe gestures without preventing vertical scroll or native text selection.
class SentenceSwipe {
  start(touches, opened, now = Date.now()) {
    this.gesture = touches?.length === 1 ? { x: touches[0].clientX, y: touches[0].clientY, now, opened, axis: '', dx: 0 } : null;
  }
  move(touches, now = Date.now()) {
    const g = this.gesture;
    if (!g || touches?.length !== 1) { this.gesture = null; return; }
    const dx = touches[0].clientX - g.x, dy = touches[0].clientY - g.y;
    if (!g.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 10)
      g.axis = now - g.now >= 350 || Math.abs(dy) >= Math.abs(dx) / 1.5 ? 'vertical' : 'horizontal';
    g.dx = dx;
  }
  end(now = Date.now()) {
    const g = this.gesture; this.gesture = null;
    if (!g || g.axis !== 'horizontal' || now - g.now >= 650 || Math.abs(g.dx) < 30) return null;
    return g.dx < 0;
  }
  cancel() { this.gesture = null; }
}
module.exports = { SentenceSwipe };
