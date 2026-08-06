Component({
  properties: {
    item: {
      type: Object,
      value: {}
    },
    collectionType: {
      type: String,
      value: 'gift'
    },
    emphasized: {
      type: Boolean,
      value: false
    },
    removing: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    previewImage() {
      this.triggerEvent('preview', { id: this.data.item.id })
    },

    openEditor() {
      this.triggerEvent('edit', { id: this.data.item.id })
    },

    handleImageError() {
      this.triggerEvent('imageerror', { id: this.data.item.id })
    }
  }
})
