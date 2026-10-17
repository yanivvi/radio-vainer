const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm']

export function castMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

// Liquidsoap harbor speaks the webcast protocol: a hello text frame,
// then binary frames from MediaRecorder. The first blob carries the
// webm header, so the recorder starts only after hello is on the wire.
export function openCast({ url, user, password, stream, mime, sampleRate, onClose }) {
  const socket = new WebSocket(url, 'webcast')
  let recorder = null
  let opened = false
  let closedByUs = false
  let notify = onClose

  const ready = new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      closedByUs = true
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      reject(error)
    }
    const timer = window.setTimeout(() => fail(new Error('unreachable')), 8000)

    const startRecorder = () => {
      if (settled || socket.readyState !== WebSocket.OPEN) return
      try {
        recorder = new MediaRecorder(stream, { mimeType: mime })
        recorder.ondataavailable = async (event) => {
          if (!event.data?.size || socket.readyState !== WebSocket.OPEN) return
          socket.send(await event.data.arrayBuffer())
        }
        recorder.onerror = () => {
          if (!closedByUs) notify?.()
        }
        recorder.start(500)
      } catch {
        fail(new Error('encode'))
        return
      }
      settled = true
      window.clearTimeout(timer)
      resolve()
    }

    socket.onopen = () => {
      opened = true
      socket.send(JSON.stringify({
        type: 'hello',
        data: {
          mime,
          user,
          password,
          audio: {
            channels: 2,
            samplerate: sampleRate || 48000,
            bitrate: 128,
            encoder: 'MediaRecorder'
          }
        }
      }))
      // A wrong password closes the socket after hello. Wait past that.
      window.setTimeout(startRecorder, 400)
    }

    socket.onerror = () => {
      if (!opened) fail(new Error('unreachable'))
    }

    socket.onclose = (event) => {
      if (!settled) {
        fail(new Error(event.code === 1011 ? 'refused' : 'unreachable'))
        return
      }
      if (closedByUs) return
      notify?.()
    }
  })

  return {
    ready,
    setTitle(title) {
      if (socket.readyState !== WebSocket.OPEN) return
      const text = String(title || '').trim().slice(0, 140)
      socket.send(JSON.stringify({
        type: 'metadata',
        data: { title: text || 'Radio Vainer' }
      }))
    },
    stop() {
      closedByUs = true
      notify = null
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }
  }
}
