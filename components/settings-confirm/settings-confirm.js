Component({
    properties: { kind: String, title: String, loggedIn: Boolean, pending: Boolean, busy: Boolean, isBook: Boolean },
    methods: {
        cancel() { if (!this.properties.busy) this.triggerEvent('cancel'); },
        confirm() { if (!this.properties.busy) this.triggerEvent('confirm'); },
        noop() {}
    }
});
