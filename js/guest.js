import { joinRoom, roomId, roomOptions } from './config.js'

const air = document.querySelector('#air')
const nameInput = document.querySelector('#guest-name')
const callBtn = document.querySelector('#call')
const note = document.querySelector('#note')
const player = document.querySelector('#player')

const callCode = new URLSearchParams(location.search).get('call') || ''
player.playsInline = true
player.volume = 1

let room
let callerAction
let hostId = null
let micStream = null
let calling = false
let welcomed = false
let announceTimer = 0

if (!callCode) {
  callBtn.hidden = true
  nameInput.disabled = true
  note.textContent = 'Open the link the studio sent you.'
} else if (!navigator.mediaDevices?.getUserMedia) {
  callBtn.disabled = true
  note.textContent = 'Open this page in Chrome or Safari.'
} else {
  note.textContent = 'Call in when you are ready. You will hear the studio.'
  join()
}

callBtn.addEventListener('click', () => {
  if (calling) hangUp()
  else callIn()
})

window.addEventListener('pagehide', () => {
  window.clearInterval(announceTimer)
  stopMic()
  room?.leave()
})

function join() {
  room = joinRoom(roomOptions({ passive: true }), roomId, {
    onJoinError() {
      note.textContent = 'Could not reach the studio. Refresh and try again.'
    }
  })
  callerAction = room.makeAction('caller')
  const status = room.makeAction('status')

  status.onMessage = (data, { peerId }) => {
    if (!data || data.role !== 'host' || !data.live) return
    hostId = peerId
    if (calling && !welcomed) announce()
  }

  callerAction.onMessage = (data, { peerId }) => {
    if (!data || peerId !== hostId) return
    if (data.kind === 'live') {
      welcomed = true
      window.clearInterval(announceTimer)
      setLive(true)
      note.textContent = 'You are on with the studio.'
      sendMic()
      return
    }
    if (data.kind === 'deny') {
      window.clearInterval(announceTimer)
      welcomed = false
      calling = false
      stopMic()
      setLive(false)
      nameInput.disabled = false
      callBtn.disabled = true
      callBtn.textContent = 'Call in'
      note.textContent = 'That link is no longer good. Ask the studio for a new one.'
      room?.leave()
      room = null
      return
    }
    if (data.kind === 'drop') {
      window.clearInterval(announceTimer)
      welcomed = false
      calling = false
      stopMic()
      stopHearing()
      setLive(false)
      nameInput.disabled = false
      callBtn.textContent = 'Call in'
      note.textContent = 'The studio ended the call.'
    }
  }

  room.onPeerJoin = (peerId) => {
    if (!hostId) hostId = peerId
    if (calling && !welcomed) announce()
  }

  room.onPeerLeave = (peerId) => {
    if (peerId !== hostId) return
    hostId = null
    welcomed = false
    stopHearing()
    setLive(false)
    if (calling) note.textContent = 'Waiting for the studio to come back.'
  }

  room.onPeerStream = (stream, peerId, metadata) => {
    if (metadata?.role !== 'return' || peerId !== hostId) return
    playReturn(stream)
  }
}

async function callIn() {
  if (!room || calling) return
  calling = true
  callBtn.disabled = true
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
    calling = false
    note.textContent = err?.name === 'NotAllowedError'
      ? 'Microphone permission was blocked.'
      : 'Could not open the microphone.'
    return
  } finally {
    callBtn.disabled = false
  }

  micStream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (calling) hangUp()
    })
  })
  nameInput.disabled = true
  callBtn.textContent = 'Hang up'
  note.textContent = hostId ? 'Calling the studio…' : 'Waiting for the studio.'
  announce()
  window.clearInterval(announceTimer)
  announceTimer = window.setInterval(() => {
    if (calling && !welcomed) announce()
  }, 2000)
}

function announce() {
  if (!calling || welcomed || !hostId || !callerAction) return
  const name = nameInput.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Guest'
  callerAction.send({ kind: 'hello', call: callCode, name }, { target: hostId }).catch(() => {})
}

function sendMic() {
  if (!room || !hostId || !micStream) return
  room.addStream(micStream, {
    target: hostId,
    metadata: { role: 'caller', call: callCode }
  })
}

function hangUp() {
  calling = false
  welcomed = false
  window.clearInterval(announceTimer)
  if (hostId && callerAction) {
    callerAction.send({ kind: 'bye' }, { target: hostId }).catch(() => {})
  }
  stopMic()
  stopHearing()
  setLive(false)
  nameInput.disabled = false
  callBtn.textContent = 'Call in'
  note.textContent = 'You left the call.'
}

function stopMic() {
  micStream?.getTracks().forEach((track) => track.stop())
  micStream = null
}

async function playReturn(stream) {
  if (player.srcObject !== stream) player.srcObject = stream
  try {
    await player.play()
  } catch {
    note.textContent = 'Tap Call in again if you cannot hear the studio.'
  }
}

function stopHearing() {
  player.pause()
  player.srcObject = null
}

function setLive(on) {
  air.textContent = on ? 'On air' : 'Off air'
  air.classList.toggle('on', on)
  air.classList.toggle('off', !on)
  document.title = on ? '● Guest caller · Radio Vainer' : 'Guest caller · Radio Vainer'
}
