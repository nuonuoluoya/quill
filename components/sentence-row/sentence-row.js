const { SentenceSwipe } = require('../../utils/sentence-swipe');
Component({
  properties: { item: Object, opened: Boolean, disabled: Boolean, pending: Boolean, favorites: Boolean },
  lifetimes: { attached() { this.swipe = new SentenceSwipe(); } },
  methods: {
    start(e) { this.suppressTap = false; this.swipe.start(e.touches, this.properties.opened); },
    move(e) { this.swipe.move(e.touches); },
    end() {
      const open = this.swipe.end();
      if (open === null || this.properties.disabled) return;
      this.suppressTap = true;
      this.triggerEvent('reveal', { id: this.properties.item.id, open });
    },
    cancel() { this.swipe.cancel(); },
    hold() { this.suppressTap = true; this.swipe.cancel(); },
    play() {
      if (this.suppressTap || this.properties.disabled) return;
      if (this.properties.opened) { this.triggerEvent('reveal', { id: this.properties.item.id, open: false }); return; }
      if (this.properties.item.available) this.triggerEvent('play', { id: this.properties.item.id, index: this.properties.item.index });
    },
    favorite() {
      if (!this.properties.disabled && !this.properties.pending)
        this.triggerEvent('favorite', { id: this.properties.item.id, saved: !this.properties.item.saved });
    },
    source() { if (!this.properties.disabled) this.triggerEvent('source', { id: this.properties.item.id }); }
  }
});
