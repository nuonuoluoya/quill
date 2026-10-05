const { SentenceSwipe } = require('../../utils/sentence-swipe');
Component({
  properties: { item: Object, opened: Boolean, disabled: Boolean, pending: Boolean, favorites: Boolean, scrollEpoch: Number },
  observers: { scrollEpoch() { if (this.swipe) this.cancel(); } },
  lifetimes: { attached() { this.swipe = new SentenceSwipe(); } },
  methods: {
    start(e) { this.swipe.start(e.touches, this.properties.opened); this.suppressTap = this.swipe.blockTap; },
    move(e) { this.swipe.move(e.touches); this.suppressTap = this.swipe.blockTap; },
    end(e) {
      if (e?.changedTouches?.length) this.swipe.move(e.changedTouches);
      const open = this.swipe.end();
      this.suppressTap = this.swipe.blockTap;
      if (open === null || this.properties.disabled || open === !!this.properties.opened) return;
      this.triggerEvent('reveal', { id: this.properties.item.id, open });
    },
    cancel() { this.suppressTap = true; this.swipe.cancel(); },
    hold() { this.suppressTap = true; this.swipe.cancel(); },
    play() {
      if (this.suppressTap || this.properties.disabled) return;
      if (this.properties.opened) { this.triggerEvent('reveal', { id: this.properties.item.id, open: false }); return; }
      if (this.properties.item.available) this.triggerEvent('play', { id: this.properties.item.id, index: this.properties.item.index });
    },
    favorite() {
      if (!this.suppressTap && !this.properties.disabled && !this.properties.pending)
        this.triggerEvent('favorite', { id: this.properties.item.id, saved: !this.properties.item.saved });
    },
    source() { if (!this.suppressTap && !this.properties.disabled) this.triggerEvent('source', { id: this.properties.item.id }); }
  }
});
