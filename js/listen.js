import { joinRoom, roomId, roomOptions } from './config.js'

const air = document.querySelector('#air')
const now = document.querySelector('#now')
const listenBtn = document.querySelector('#listen')
const volume = document.querySelector('#volume')
const count = document.querySelector('#count')
const note = document.querySelector('#note')
const canvas = document.querySelector('#scope')

const sources = new WeakMap()
let audioCtx
let gain
let analyser
let sourceNode
let pendingStream
let playingStream
let hostId = null
let armed = false
let raf = 0

const room = joinRoom(roomOptions({ passive: true }), roomId, {
  onJoinError() {
    note.textContent = 'Could not reach the studio. Refresh and try again.'
  }
})

const status = room.makeAction('status')

status.onMessage = (data, { peerId }) => {
  if (!data || data.role !== 'host') return
  if (!data.live) {
    if (peerId === hostId) goOffAir()
    return
  }
  if (hostId && peerId !== hostId) return
  hostId = peerId
  showLive(data)
}

room.onPeerJoin = (peerId) => {
  if (!hostId) hostId = peerId
  air.textContent = 'Live'
  air.classList.add('on')
  air.classList.remove('off')
  if (now.textContent === 'Waiting for the studio' || now.textContent === 'Off air') {
    now.textContent = 'Live from the studio'
  }
  if (!armed) note.textContent = 'Press listen.'
}

room.onPeerLeave = (peerId) => {
  if (peerId === hostId) goOffAir()
}

room.onPeerStream = (stream, peerId, metadata) => {
  if (metadata?.role && metadata.role !== 'station') return
  if (hostId && peerId !== hostId) return
  if (!stream.getAudioTracks().length) return
  hostId = peerId
  air.textContent = 'Live'
  air.classList.add('on')
  air.classList.remove('off')
  pendingStream = stream
  if (armed) connect(stream)
  else note.textContent = 'Press listen.'
}

listenBtn.addEventListener('click', async () => {
  const ctx = ensureAudio()
  if (armed && ctx.state === 'running') {
    await ctx.suspend()
    armed = false
    listenBtn.textContent = 'Listen'
    stopDraw()
    if (air.classList.contains('on')) note.textContent = 'Press listen.'
    return
  }
  await ctx.resume()
  armed = true
  listenBtn.textContent = 'Pause'
  note.textContent = pendingStream ? '' : 'Tuning in. Sound starts when the studio is live.'
  if (pendingStream) connect(pendingStream)
})

volume.addEventListener('input', () => {
  if (gain) gain.gain.value = Number(volume.value)
})

function ensureAudio() {
  if (audioCtx) return audioCtx
  audioCtx = new AudioContext()
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256
  gain = audioCtx.createGain()
  gain.gain.value = Number(volume.value)
  analyser.connect(gain)
  gain.connect(audioCtx.destination)
  return audioCtx
}

function connect(stream) {
  if (playingStream === stream && sourceNode) {
    if (audioCtx.state === 'running') draw()
    return
  }
  if (sourceNode) sourceNode.disconnect()
  let node = sources.get(stream)
  if (!node) {
    node = audioCtx.createMediaStreamSource(stream)
    sources.set(stream, node)
  }
  node.connect(analyser)
  sourceNode = node
  playingStream = stream
  pendingStream = stream
  note.textContent = ''
  draw()
}

function showLive(data) {
  air.textContent = 'Live'
  air.classList.add('on')
  air.classList.remove('off')
  now.textContent = data.title?.trim() || 'Live from the studio'
  const n = Number(data.listeners) || 0
  count.textContent = n === 0 ? 'No listeners yet' : n === 1 ? '1 listening' : `${n} listening`
  if (!armed) note.textContent = 'Press listen.'
  document.title = '● Radio Vainer'
}

function goOffAir() {
  hostId = null
  pendingStream = null
  playingStream = null
  if (sourceNode) {
    sourceNode.disconnect()
    sourceNode = null
  }
  stopDraw()
  clearScope()
  air.textContent = 'Off air'
  air.classList.add('off')
  air.classList.remove('on')
  now.textContent = 'Off air'
  count.textContent = ''
  if (armed) note.textContent = 'The studio stopped. This will play again when it returns.'
  document.title = 'Radio Vainer'
}

function draw() {
  cancelAnimationFrame(raf)
  const ctx = canvas.getContext('2d')
  const bins = new Uint8Array(analyser.frequencyBinCount)
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const frame = () => {
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const pxW = Math.floor(width * dpr)
    const pxH = Math.floor(height * dpr)
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW
      canvas.height = pxH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    analyser.getByteFrequencyData(bins)
    const bars = 42
    const gap = 3
    const barWidth = (width - gap * (bars - 1)) / bars
    for (let i = 0; i < bars; i += 1) {
      const value = bins[i] / 255
      const h = Math.max(2, value * height)
      ctx.globalAlpha = 0.4 + value * 0.6
      ctx.fillStyle = '#e8a54b'
      ctx.fillRect(i * (barWidth + gap), height - h, barWidth, h)
    }
    ctx.globalAlpha = 1
    if (!reduce) raf = requestAnimationFrame(frame)
  }

  frame()
}

function stopDraw() {
  cancelAnimationFrame(raf)
  raf = 0
}

function clearScope() {
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}
