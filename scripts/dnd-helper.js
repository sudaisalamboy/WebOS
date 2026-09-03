/**
 * Helper: simulate HTML5 drag-and-drop between two elements.
 * Agent-browser doesn't natively support drag events, so we dispatch them
 * directly with a real DataTransfer-like object.
 *
 * Usage in browser eval:
 *   simulateDnD(sourceEl, targetEl, '/path/to/file')
 */
(function installDnDHelper() {
  // @ts-ignore - attach to window for easy access
  window.simulateDnD = function simulateDnD(srcEl, destEl, path) {
    // Build a minimal DataTransfer shim that supports the parts React reads
    const store = new Map()
    const types = []
    const dataTransfer = {
      get types() { return types },
      effectAllowed: 'move',
      dropEffect: 'move',
      setData(t, v) { types.push(t); store.set(t, v) },
      getData(t) { return store.get(t) || '' },
      clearData(t) { if (t) { store.delete(t); } else { store.clear(); } },
    }
    dataTransfer.setData('application/x-webos-filepath', path)
    dataTransfer.setData('text/plain', path)

    const dragRect = srcEl.getBoundingClientRect()
    const dropRect = destEl.getBoundingClientRect()
    const dragPt = { clientX: dragRect.left + 20, clientY: dragRect.top + 20 }
    const dropPt = { clientX: dropRect.left + 50, clientY: dropRect.top + 50 }

    const events = [
      { type: 'dragstart', target: srcEl, point: dragPt },
      { type: 'drag', target: srcEl, point: dragPt },
      { type: 'dragenter', target: destEl, point: dropPt },
      { type: 'dragover', target: destEl, point: dropPt },
      { type: 'drop', target: destEl, point: dropPt },
      { type: 'dragend', target: srcEl, point: dragPt },
    ]

    for (const ev of events) {
      const evt = new MouseEvent(ev.type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: ev.point.clientX,
        clientY: ev.point.clientY,
      })
      Object.defineProperty(evt, 'dataTransfer', { value: dataTransfer, writable: false })
      ev.target.dispatchEvent(evt)
    }
    return 'simulated drop: ' + path
  }
})()
