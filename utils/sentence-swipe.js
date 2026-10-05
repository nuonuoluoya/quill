// Observe gestures without preventing vertical scroll or native text selection.
class SentenceSwipe {
  start(touches, opened, now = Date.now()) {
    this.blockTap = touches?.length !== 1;
    this.gesture = !this.blockTap ? { x: touches[0].clientX, y: touches[0].clientY, now, opened: !!opened, axis: '', dx: 0, dy: 0 } : null;
  }
  move(touches, now = Date.now()) {
    const g = this.gesture;
    if (!g) return;
    if (touches?.length !== 1) { this.cancel(); return; }
    const dx = touches[0].clientX - g.x, dy = touches[0].clientY - g.y;
    g.dx = dx; g.dy = dy;
    const x = Math.abs(dx), y = Math.abs(dy);
    if (Math.max(x,y) < 10) return;
    this.blockTap = true;
    if (g.axis === 'vertical') return;
    // A horizontal candidate can be cancelled by later vertical movement.
    if ((!g.axis && now - g.now >= 350) || (y >= 10 && y * 1.5 >= x)) g.axis = 'vertical';
    else if (x >= 10 && x > y * 1.5) g.axis = 'horizontal';
  }
  end(now = Date.now()) {
    const g = this.gesture; this.gesture = null;
    if (g && now - g.now >= 350 && !g.axis) this.blockTap = true;
    if (!g || g.axis !== 'horizontal' || now - g.now >= 650 || Math.abs(g.dx) < 30 || Math.abs(g.dx) <= Math.abs(g.dy) * 1.5) return null;
    const opened = g.dx < 0;
    return opened === g.opened ? null : opened;
  }
  cancel() { this.gesture = null; this.blockTap = true; }
}
module.exports = { SentenceSwipe };
