import { mountListenerChat } from './chat.js'
import { joinRoom, roomId, roomOptions } from './config.js'

const air = document.querySelector('#air')
const now = document.querySelector('#now')
const listenBtn = document.querySelector('#listen')
const volume = document.querySelector('#volume')
const count = document.querySelector('#count')
const note = document.querySelector('#note')
const canvas = document.querySelector('#scope')

const sources = new WeakMap()
const player = document.querySelector('#player')
player.playsInline = true
player.volume = 0.9

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
  if (now.textContent === 'Waiting for the studio' || now.textContent === 'Off air') {
    now.textContent = 'Live from the studio'
  }
  if (!armed) note.textContent = 'Press listen.'
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
  if (armed) {
    playStream(stream).catch(() => askToListen())
  } else {
    note.textContent = 'Press listen.'
  }
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

volume.addEventListener('input', () => {
  player.volume = Number(volume.value)
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
  if (air.classList.contains('on')) note.textContent = 'Press listen.'
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
  player.volume = Number(volume.value)
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
  const title = now.textContent
  const named = title && title !== 'Waiting for the studio' && title !== 'Off air'
  navigator.mediaSession.playbackState = state
  navigator.mediaSession.metadata = new MediaMetadata({
    title: named ? title : 'Radio Vainer',
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
  now.textContent = data.title?.trim() || 'Live from the studio'
  const n = Number(data.listeners) || 0
  count.textContent = n === 0 ? 'No listeners yet' : n === 1 ? '1 listening' : `${n} listening`
  if (!armed) note.textContent = 'Press listen.'
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
  now.textContent = 'Off air'
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

function clearScope() {
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}
