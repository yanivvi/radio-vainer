import { mountListenerChat } from './chat.js'
import { joinRoom, roomId, roomOptions } from './config.js'

const HOST_STALE_MS = 12000

const air = document.querySelector('#air')
const hostMessage = document.querySelector('#host-message')
const listenBtn = document.querySelector('#listen')
const note = document.querySelector('#note')
const canvas = document.querySelector('#scope')

const player = document.querySelector('#player')
player.playsInline = true
player.volume = 1

let audioCtx
let analyser
let sourceNode
let meterStream
let pendingStream
let playingStream
let hostId = null
let lastHostBeat = 0
let armed = false
let ignorePause = false
let raf = 0
let hearingTimer = 0

const streams = new Map()

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
    return hostId === peerId && Date.now() - lastHostBeat < HOST_STALE_MS
  }
})

const status = room.makeAction('status')
const presence = room.makeAction('presence')

status.onMessage = (data, { peerId }) => {
  if (!data || data.role !== 'host') return
  if (!data.live) {
    if (peerId === hostId) goOffAir(true)
    return
  }
  if (!acceptHost(peerId, true)) return
  showLive(data)
  const saved = streams.get(peerId)
  if (!saved) return
  pendingStream = saved
  if (armed) playStream(saved).catch(() => askToListen())
}

room.onPeerLeave = (peerId) => {
  streams.delete(peerId)
  if (peerId === hostId) goOffAir(false)
}

room.onPeerStream = (stream, peerId, metadata) => {
  if (metadata?.role !== 'station') return
  if (!stream.getAudioTracks().length) return
  streams.set(peerId, stream)
  if (!acceptHost(peerId, true)) return
  pendingStream = stream
  markLive()
  if (armed) playStream(stream).catch(() => askToListen())
  chat.hostHere()
}

window.setInterval(() => {
  if (!hostId) return
  if (Date.now() - lastHostBeat < HOST_STALE_MS) return
  goOffAir(false)
}, 2000)

listenBtn.addEventListener('click', () => {
  if (armed) stopListening()
  else startListening()
})

player.addEventListener('pause', () => {
  if (ignorePause || !armed) return
  stopListening()
})

function acceptHost(peerId, beat) {
  const fresh = hostId && Date.now() - lastHostBeat < HOST_STALE_MS
  if (hostId && peerId !== hostId && fresh) return false
  const switched = hostId !== peerId
  hostId = peerId
  if (beat || switched) lastHostBeat = Date.now()
  return true
}

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
  releaseMeter()
  audioCtx?.suspend()
  watchHearing(false)
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
  if (player.srcObject === stream && !player.paused) {
    if (playingStream !== stream) {
      try {
        attachMeter(stream)
        if (analyser) draw()
      } catch {
        // The station still plays if the meter cannot attach.
      }
    }
    return
  }
  if (player.srcObject !== stream) player.srcObject = stream
  await player.play()
  publishSession('playing')
  watchHearing(true)
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
  releaseMeter()
  try {
    // A clone keeps the audible stream on the element alone.
    meterStream = stream.clone()
    sourceNode = audioCtx.createMediaStreamSource(meterStream)
    sourceNode.connect(analyser)
    playingStream = stream
  } catch {
    releaseMeter()
  }
}

function releaseMeter() {
  sourceNode?.disconnect()
  sourceNode = null
  meterStream?.getTracks().forEach((track) => track.stop())
  meterStream = null
  playingStream = null
}

function watchHearing(on) {
  window.clearInterval(hearingTimer)
  hearingTimer = 0
  presence.send({ kind: 'hearing', on: !!on }).catch(() => {})
  if (!on) return
  hearingTimer = window.setInterval(() => {
    presence.send({ kind: 'hearing', on: true }).catch(() => {})
  }, 5000)
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
  watchHearing(false)
  note.textContent = 'Press listen to hear the station.'
}

function markLive() {
  air.textContent = 'Live'
  air.classList.add('on')
  air.classList.remove('off')
  document.title = '● Radio Vainer'
}

function showLive(data) {
  markLive()
  const message = String(data.message || '').trim().slice(0, 140)
  hostMessage.textContent = message
  hostMessage.hidden = message.length === 0
  if (!player.paused) publishSession('playing')
  chat.hostHere()
}

function goOffAir(immediateChat) {
  hostId = null
  lastHostBeat = 0
  pendingStream = null
  ignorePause = true
  player.pause()
  ignorePause = false
  player.srcObject = null
  publishSession('none')
  audioCtx?.suspend()
  releaseMeter()
  stopDraw()
  clearScope()
  watchHearing(false)
  air.textContent = 'Off air'
  air.classList.add('off')
  air.classList.remove('on')
  hostMessage.textContent = ''
  hostMessage.hidden = true
  if (armed) note.textContent = 'The studio stopped. This will play again when it returns.'
  document.title = 'Radio Vainer'
  chat.hostLeft(immediateChat)
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
