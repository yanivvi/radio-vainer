import { mountListenerChat } from './chat.js'
import { joinRoom, roomId, roomOptions } from './config.js'

const air = document.querySelector('#air')
const hostMessage = document.querySelector('#host-message')
const listenBtn = document.querySelector('#listen')
const count = document.querySelector('#count')
const note = document.querySelector('#note')
const canvas = document.querySelector('#scope')

const sources = new WeakMap()
const player = document.querySelector('#player')
player.playsInline = true
player.volume = 1

let audioCtx
let analyser
let sourceNode
let pendingStream
let playingStream
let hostId = null
let armed = false
let ignorePause = false
let raf = 0

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => { startListening() })
  navigator.mediaSession.setActionHandler('pause', () => { stopListening() })
}

const room = joinRoom(roomOptions({ passive: true }), roomId, {
  onJoinError() {
    note.textContent = 'Could not reach the studio. Refresh and try again.'
  }
})

const chat = mountListenerChat({
  room,
  getHostId: () => hostId,
  claimHost(peerId) {
    if (hostId && peerId !== hostId) return false
    hostId = peerId
    return true
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
  chat.hostHere()
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
  if (armed) playStream(stream).catch(() => askToListen())
  chat.hostHere()
}

listenBtn.addEventListener('click', () => {
  if (armed) stopListening()
  else startListening()
})

player.addEventListener('pause', () => {
  if (ignorePause || !armed) return
  stopListening()
})

async function startListening() {
  armed = true
  listenBtn.textContent = 'Pause'
  if (!pendingStream) {
    note.textContent = 'Tuning in. Sound starts when the studio is live.'
    publishSession('paused')
    return
  }
  try {
    await playStream(pendingStream)
  } catch {
    askToListen()
  }
}

function stopListening() {
  ignorePause = true
  player.pause()
  ignorePause = false
  armed = false
  listenBtn.textContent = 'Listen'
  stopDraw()
  audioCtx?.suspend()
  publishSession('paused')
  note.textContent = ''
}

function ensureAudio() {
  if (audioCtx) return audioCtx
  audioCtx = new AudioContext()
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256
  // The meter must not reach the speakers. The audio element is the only
  // output, so the phone keeps this playing when the screen locks.
  const silent = audioCtx.createGain()
  silent.gain.value = 0
  analyser.connect(silent)
  silent.connect(audioCtx.destination)
  return audioCtx
}

async function playStream(stream) {
  pendingStream = stream
  player.muted = false
  player.volume = 1
  if (player.srcObject !== stream) player.srcObject = stream
  await player.play()
  publishSession('playing')
  try {
    ensureAudio()
    await audioCtx.resume()
    attachMeter(stream)
    if (analyser) draw()
  } catch {
    // The station still plays if the meter cannot attach.
  }
  note.textContent = ''
}

function attachMeter(stream) {
  ensureAudio()
  audioCtx.resume().catch(() => {})
  if (playingStream === stream && sourceNode) return
  if (sourceNode) sourceNode.disconnect()
  let node = sources.get(stream)
  if (!node) {
    node = audioCtx.createMediaStreamSource(stream)
    sources.set(stream, node)
  }
  node.connect(analyser)
  sourceNode = node
  playingStream = stream
}

function publishSession(state) {
  if (!('mediaSession' in navigator)) return
  const message = hostMessage.hidden ? '' : hostMessage.textContent.trim()
  navigator.mediaSession.playbackState = state
  navigator.mediaSession.metadata = new MediaMetadata({
    title: message || 'Radio Vainer',
    artist: 'Radio Vainer',
    artwork: [{
      src: new URL('favicon.png', location.href).href,
      sizes: '192x192',
      type: 'image/png'
    }]
  })
}

function askToListen() {
  armed = false
  listenBtn.textContent = 'Listen'
  publishSession('paused')
  note.textContent = 'Press listen to hear the station.'
}

function showLive(data) {
  air.textContent = 'Live'
  air.classList.add('on')
  air.classList.remove('off')
  const message = String(data.message || '').trim().slice(0, 140)
  hostMessage.textContent = message
  hostMessage.hidden = message.length === 0
  const n = Number(data.listeners) || 0
  count.textContent = n === 0 ? 'No listeners yet' : n === 1 ? '1 listening' : `${n} listening`
  document.title = '● Radio Vainer'
  if (!player.paused) publishSession('playing')
  chat.hostHere()
}

function goOffAir() {
  hostId = null
  pendingStream = null
  playingStream = null
  ignorePause = true
  player.pause()
  ignorePause = false
  player.srcObject = null
  publishSession('none')
  audioCtx?.suspend()
  if (sourceNode) {
    sourceNode.disconnect()
    sourceNode = null
  }
  stopDraw()
  clearScope()
  air.textContent = 'Off air'
  air.classList.add('off')
  air.classList.remove('on')
  hostMessage.textContent = ''
  hostMessage.hidden = true
  count.textContent = ''
  if (armed) note.textContent = 'The studio stopped. This will play again when it returns.'
  document.title = 'Radio Vainer'
  chat.hostLeft()
}

function draw() {
  if (!analyser) return
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
      ctx.fillStyle = '#f07832'
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

pinComposer(document.querySelector('#chat-form'))

function pinComposer(form) {
  const viewport = window.visualViewport
  if (!viewport || !form) return
  const update = () => {
    const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    document.documentElement.style.setProperty('--keyboard', `${Math.round(keyboard)}px`)
  }
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()
}

function clearScope() {
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}
