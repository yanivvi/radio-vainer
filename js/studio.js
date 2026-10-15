import { joinRoom, roomId, roomOptions } from './config.js'

const air = document.querySelector('#air')
const goLiveBtn = document.querySelector('#go-live')
const micBtn = document.querySelector('#mic')
const musicBtn = document.querySelector('#music')
const micGainInput = document.querySelector('#mic-gain')
const musicGainInput = document.querySelector('#music-gain')
const micMeter = document.querySelector('#mic-meter')
const musicMeter = document.querySelector('#music-meter')
const titleInput = document.querySelector('#title')
const statusEl = document.querySelector('#status')
const listenersEl = document.querySelector('#listeners')

let audioCtx
let destination
let micStream
let micSource
let micGain
let micAnalyser
let displayStream
let musicSource
let musicGain
let musicAnalyser
let room
let statusAction
let pulse
let wakeLock
let raf = 0
let micBusy = false
let musicBusy = false

if (!navigator.mediaDevices?.getUserMedia) {
  setStatus('Open the studio in Chrome or Edge on this computer.')
}

micBtn.addEventListener('click', () => {
  if (micStream) stopMic()
  else startMic()
})

musicBtn.addEventListener('click', () => {
  if (displayStream) stopMusic()
  else startMusic()
})

micGainInput.addEventListener('input', () => {
  if (micGain) micGain.gain.value = sliderValue(micGainInput)
})

musicGainInput.addEventListener('input', () => {
  if (musicGain) musicGain.gain.value = sliderValue(musicGainInput)
})

titleInput.addEventListener('input', () => {
  if (room) publish()
})

goLiveBtn.addEventListener('click', () => {
  if (room) stopBroadcast()
  else startBroadcast()
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && room) keepAwake()
})

window.addEventListener('pagehide', release)

function ensureGraph() {
  if (audioCtx) return
  audioCtx = new AudioContext()
  destination = audioCtx.createMediaStreamDestination()
  loopMeters()
}

async function startMic() {
  if (micBusy) return
  micBusy = true
  micBtn.disabled = true
  ensureGraph()
  await audioCtx.resume()
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      },
      video: false
    })
  } catch (err) {
    micStream = null
    setStatus(err?.name === 'NotAllowedError'
      ? 'Microphone permission was blocked.'
      : 'Could not open the microphone.')
    return
  } finally {
    micBusy = false
    micBtn.disabled = false
  }

  micSource = audioCtx.createMediaStreamSource(micStream)
  micGain = audioCtx.createGain()
  micGain.gain.value = sliderValue(micGainInput)
  micAnalyser = audioCtx.createAnalyser()
  micAnalyser.fftSize = 1024
  micSource.connect(micGain)
  micGain.connect(destination)
  micGain.connect(micAnalyser)
  micStream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', stopMic)
  })
  micBtn.textContent = 'Turn off microphone'
  micBtn.setAttribute('aria-pressed', 'true')
  setStatus('')
}

function stopMic() {
  micStream?.getTracks().forEach((track) => track.stop())
  micSource?.disconnect()
  micGain?.disconnect()
  micStream = null
  micSource = null
  micGain = null
  micAnalyser = null
  micBtn.textContent = 'Turn on microphone'
  micBtn.setAttribute('aria-pressed', 'false')
}

async function startMusic() {
  if (musicBusy) return
  musicBusy = true
  musicBtn.disabled = true
  ensureGraph()
  await audioCtx.resume()
  let captured
  try {
    captured = await captureSystemAudio()
  } catch (err) {
    if (err?.name !== 'NotAllowedError') {
      setStatus('Could not capture music from this computer.')
    }
    return
  } finally {
    musicBusy = false
    musicBtn.disabled = false
  }

  const audioTracks = captured.getAudioTracks()
  if (audioTracks.length === 0) {
    captured.getTracks().forEach((track) => track.stop())
    setStatus('That share had no audio. Try again and turn on Share system audio.')
    return
  }

  displayStream = captured
  // The video track has to stay alive. Stopping it ends the audio capture.
  // It is never played or sent; listeners only receive the mixed audio.
  captured.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', stopMusic)
  })
  audioTracks.forEach((track) => track.addEventListener('ended', stopMusic))

  musicSource = audioCtx.createMediaStreamSource(new MediaStream(audioTracks))
  musicGain = audioCtx.createGain()
  musicGain.gain.value = sliderValue(musicGainInput)
  musicAnalyser = audioCtx.createAnalyser()
  musicAnalyser.fftSize = 1024
  musicSource.connect(musicGain)
  musicGain.connect(destination)
  musicGain.connect(musicAnalyser)
  musicBtn.textContent = 'Stop music capture'
  musicBtn.setAttribute('aria-pressed', 'true')
  setStatus('Music is in the mix. Listeners do not see the screen.')
}

function stopMusic() {
  displayStream?.getTracks().forEach((track) => track.stop())
  musicSource?.disconnect()
  musicGain?.disconnect()
  displayStream = null
  musicSource = null
  musicGain = null
  musicAnalyser = null
  musicBtn.textContent = 'Capture music'
  musicBtn.setAttribute('aria-pressed', 'false')
}

async function captureSystemAudio() {
  const attempts = [
    {
      video: { frameRate: 5, width: 320, height: 180 },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false
      },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      monitorTypeSurfaces: 'include',
      surfaceSwitching: 'include'
    },
    { video: true, audio: true }
  ]

  let lastError
  for (const options of attempts) {
    try {
      return await navigator.mediaDevices.getDisplayMedia(options)
    } catch (err) {
      if (err?.name === 'NotAllowedError') throw err
      lastError = err
    }
  }
  throw lastError
}

function startBroadcast() {
  ensureGraph()
  audioCtx.resume().catch(() => {})
  room = joinRoom(roomOptions(), roomId, {
    onJoinError() {
      setStatus('The studio could not connect. Refresh and go live again.')
    }
  })
  statusAction = room.makeAction('status')
  const output = destination.stream

  room.onPeerJoin = (peerId) => {
    room.addStream(output, { target: peerId, metadata: { role: 'station' } })
    publish(peerId)
  }
  room.onPeerLeave = () => publish()
  room.addStream(output, { metadata: { role: 'station' } })

  goLiveBtn.textContent = 'Stop broadcast'
  goLiveBtn.setAttribute('aria-pressed', 'true')
  setOnAir(true)
  publish()
  pulse = window.setInterval(() => publish(), 3000)
  keepAwake()
  document.title = '● On air · Radio Vainer'
  if (!micStream && !displayStream) {
    setStatus('You are live. Turn on the microphone or capture music so there is something to hear.')
  }
}

async function stopBroadcast() {
  window.clearInterval(pulse)
  pulse = null
  try {
    await statusAction?.send({ role: 'host', live: false, title: '', listeners: 0 })
  } catch {
    // The room may already be empty.
  }
  room?.leave()
  room = null
  statusAction = null
  wakeLock?.release?.().catch(() => {})
  wakeLock = null
  goLiveBtn.textContent = 'Go live'
  goLiveBtn.setAttribute('aria-pressed', 'false')
  setOnAir(false)
  listenersEl.textContent = ''
  document.title = 'Studio · Radio Vainer'
  setStatus('Broadcast stopped.')
}

function publish(target) {
  if (!statusAction || !room) return
  const payload = {
    role: 'host',
    live: true,
    title: titleInput.value.trim(),
    listeners: peerCount()
  }
  const options = target ? { target } : undefined
  statusAction.send(payload, options).catch(() => {})
  listenersEl.textContent = payload.listeners === 0
    ? 'No listeners yet'
    : payload.listeners === 1
      ? '1 listening'
      : `${payload.listeners} listening`
}

function peerCount() {
  const peers = room.getPeers()
  if (peers instanceof Map) return peers.size
  return Object.keys(peers).length
}

function setOnAir(on) {
  air.textContent = on ? 'Live' : 'Off air'
  air.classList.toggle('on', on)
  air.classList.toggle('off', !on)
}

function setStatus(message) {
  statusEl.textContent = message
}

function sliderValue(input) {
  return Number(input.value) / 100
}

async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen')
  } catch {
    wakeLock = null
  }
}

function loopMeters() {
  const micCtx = micMeter.getContext('2d')
  const musicCtx = musicMeter.getContext('2d')
  const sample = new Uint8Array(1024)

  const frame = () => {
    paintMeter(micCtx, micMeter, micAnalyser, sample)
    paintMeter(musicCtx, musicMeter, musicAnalyser, sample)
    raf = requestAnimationFrame(frame)
  }
  frame()
}

function paintMeter(ctx, canvas, analyserNode, sample) {
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth || 280
  const height = canvas.clientHeight || 10
  const pxW = Math.floor(width * dpr)
  const pxH = Math.floor(height * dpr)
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#3a322a'
  ctx.fillRect(0, height / 2 - 2, width, 4)

  let level = 0
  if (analyserNode) {
    analyserNode.getByteTimeDomainData(sample)
    let sum = 0
    const count = analyserNode.fftSize
    for (let i = 0; i < count; i += 1) {
      const n = (sample[i] - 128) / 128
      sum += n * n
    }
    level = Math.min(1, Math.sqrt(sum / count) * 3.2)
  }
  ctx.fillStyle = level > 0.85 ? '#e23d2b' : '#e8a54b'
  ctx.fillRect(0, height / 2 - 2, Math.max(0, width * level), 4)
}

function release() {
  window.clearInterval(pulse)
  cancelAnimationFrame(raf)
  micStream?.getTracks().forEach((track) => track.stop())
  displayStream?.getTracks().forEach((track) => track.stop())
  room?.leave()
  audioCtx?.close()
}
