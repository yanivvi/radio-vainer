import { suggestName } from './names.js'
import { cleanPicture, pictureElement, pictures, suggestPicture } from './pictures.js'

const MAX_LOG = 40
const STUDIO_NAME = 'Studio'

// Listeners join passively, so they only connect to the studio.
// The studio relays every message.

export function mountListenerChat({ room, getHostId, claimHost }) {
  const gate = document.querySelector('#chat-gate')
  const live = document.querySelector('#chat-live')
  const nameInput = document.querySelector('#chat-name')
  const pictureRow = document.querySelector('#chat-pictures')
  const suggestBtn = document.querySelector('#chat-suggest')
  const you = document.querySelector('#chat-you')
  const youPicture = document.querySelector('#chat-you-picture')
  const empty = document.querySelector('#chat-empty')
  const log = document.querySelector('#chat-log')
  const scroll = document.querySelector('#chat-scroll')
  const form = document.querySelector('#chat-form')
  const textInput = document.querySelector('#chat-text')
  const leaveBtn = document.querySelector('#chat-leave')
  const note = document.querySelector('#chat-note')

  const action = room.makeAction('chat')
  const messages = []
  const seen = new Set()
  const dropped = new Set()
  let name = ''
  let picture = suggestPicture()
  let started = false
  let announced = false

  nameInput.value = suggestName()
  const pictureChoices = new Map()
  for (const item of pictures) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'picture-choice'
    button.setAttribute('aria-label', item.label)
    button.setAttribute('aria-pressed', item.id === picture ? 'true' : 'false')
    button.append(pictureElement(item.id))
    button.addEventListener('click', () => {
      picture = item.id
      for (const [id, choice] of pictureChoices) {
        choice.setAttribute('aria-pressed', id === picture ? 'true' : 'false')
      }
    })
    pictureChoices.set(item.id, button)
    pictureRow.append(button)
  }

  suggestBtn.addEventListener('click', () => {
    nameInput.value = suggestName()
    nameInput.focus()
  })

  gate.addEventListener('submit', (event) => {
    event.preventDefault()
    const chosen = cleanName(nameInput.value)
    if (!chosen) {
      setNote(nameInput.value.trim().toLowerCase() === 'studio'
        ? 'That name is reserved for the studio.'
        : 'Choose a name.')
      nameInput.focus()
      return
    }
    name = chosen
    picture = cleanPicture(picture)
    started = true
    announced = false
    gate.hidden = true
    live.hidden = false
    you.textContent = name
    youPicture.replaceChildren(pictureElement(picture))
    setNote(getHostId() ? '' : 'Waiting for the studio.')
    paintAll()
    sendJoin()
    textInput.focus()
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!started) return
    const text = cleanText(textInput.value)
    if (!text) return
    if (!getHostId()) {
      setNote('The studio is not here yet.')
      return
    }
    const message = { id: makeId(), name, text, admin: false, picture, at: Date.now() }
    addMessage(message)
    action.send({ kind: 'say', id: message.id, name, text, picture, at: message.at }).catch(() => {
      setNote('Could not send. Try again.')
    })
    textInput.value = ''
  })

  leaveBtn.addEventListener('click', () => {
    if (getHostId()) action.send({ kind: 'leave' }).catch(() => {})
    started = false
    announced = false
    clearMessages()
    live.hidden = true
    gate.hidden = false
    setNote('')
    nameInput.focus()
  })

  action.onMessage = (data, { peerId }) => {
    if (!data || typeof data !== 'object') return
    if (!claimHost(peerId)) return
    if (data.kind === 'log' && Array.isArray(data.messages)) {
      mergeLog(data.messages)
      return
    }
    if (data.kind === 'said') {
      addMessage(data)
      return
    }
    if (data.kind === 'drop') forget(cleanId(data.id))
  }

  return {
    hostHere() {
      if (!started || announced) return
      setNote('')
      sendJoin()
    },
    hostLeft() {
      announced = false
      dropped.clear()
      clearMessages()
      setNote(started ? 'The studio left. The chat returns when it is back.' : '')
    }
  }

  function sendJoin() {
    if (!started || !getHostId()) return
    announced = true
    action.send({ kind: 'join', name, picture }).catch(() => {
      announced = false
    })
  }

  function mergeLog(incoming) {
    const history = []
    const historyIds = new Set()
    for (const raw of incoming.slice(-MAX_LOG)) {
      const message = normalize(raw)
      if (!message || historyIds.has(message.id) || dropped.has(message.id)) continue
      historyIds.add(message.id)
      history.push(message)
    }
    const extras = messages.filter((message) => !historyIds.has(message.id))
    messages.length = 0
    seen.clear()
    for (const message of history.concat(extras)) {
      seen.add(message.id)
      messages.push(message)
    }
    trim()
    if (started) paintAll()
  }

  function addMessage(raw) {
    const message = normalize(raw)
    if (!message || dropped.has(message.id) || seen.has(message.id)) return
    seen.add(message.id)
    messages.push(message)
    trim()
    if (started) paint(message)
  }

  function paintAll() {
    log.replaceChildren()
    messages.forEach(paint)
    syncEmpty()
  }

  function paint(message) {
    log.append(renderMessage(message))
    syncEmpty()
    scroll.scrollTop = scroll.scrollHeight
  }

  function forget(id) {
    if (!id) return
    dropped.add(id)
    if (!seen.has(id)) return
    seen.delete(id)
    const index = messages.findIndex((message) => message.id === id)
    if (index !== -1) messages.splice(index, 1)
    log.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove()
    syncEmpty()
  }

  function trim() {
    while (messages.length > MAX_LOG) {
      const old = messages.shift()
      seen.delete(old.id)
      log.querySelector(`[data-id="${CSS.escape(old.id)}"]`)?.remove()
    }
  }

  function clearMessages() {
    messages.length = 0
    seen.clear()
    log.replaceChildren()
    syncEmpty()
  }

  function syncEmpty() {
    empty.hidden = log.childElementCount > 0
  }

  function setNote(message) {
    note.textContent = message
  }

}

export function mountStudioChat() {
  const live = document.querySelector('#studio-chat-live')
  const empty = document.querySelector('#studio-chat-empty')
  const log = document.querySelector('#studio-chat-log')
  const scroll = document.querySelector('#studio-chat-scroll')
  const form = document.querySelector('#studio-chat-form')
  const textInput = document.querySelector('#studio-chat-text')
  const peopleEl = document.querySelector('#studio-chat-people')
  const note = document.querySelector('#studio-chat-note')

  const messages = []
  const seen = new Set()
  const people = new Map()
  let action = null

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!action) return
    const text = cleanText(textInput.value)
    if (!text) return
    const message = { id: makeId(), name: STUDIO_NAME, text, admin: true, picture: 'studio', at: Date.now() }
    remember(message)
    relay(message)
    textInput.value = ''
    textInput.focus()
  })

  return {
    attach(room) {
      action = room.makeAction('chat')
      live.hidden = false
      note.textContent = ''
      renderPeople()
      action.onMessage = (data, { peerId }) => {
        if (!data || typeof data !== 'object') return
        if (data.kind === 'join') {
          if (welcome(peerId, data.name, data.picture)) sendLog(peerId)
          return
        }
        if (data.kind === 'leave') {
          const person = people.get(peerId)
          people.delete(peerId)
          renderPeople()
          if (person) addNotice(`${person.name} left`)
          return
        }
        if (data.kind === 'say') acceptSay(peerId, data)
      }
    },
    detach() {
      action = null
      messages.length = 0
      seen.clear()
      people.clear()
      log.replaceChildren()
      peopleEl.replaceChildren()
      textInput.value = ''
      empty.hidden = false
      live.hidden = true
      note.textContent = 'Go live to open the chat.'
    },
    peerLeft(peerId) {
      const person = people.get(peerId)
      if (!person) return
      people.delete(peerId)
      renderPeople()
      addNotice(`${person.name} left`)
    }
  }

  function welcome(peerId, rawName, rawPicture) {
    const name = cleanName(rawName)
    if (!name) return false
    const arrived = !people.has(peerId)
    people.set(peerId, { name, picture: cleanPicture(rawPicture) })
    renderPeople()
    if (arrived) addNotice(`${name} joined`)
    return true
  }

  function acceptSay(peerId, data) {
    const name = cleanName(data.name)
    const text = cleanText(data.text)
    const id = cleanId(data.id)
    if (!name || !text || !id) return
    const isNew = !people.has(peerId)
    const picture = cleanPicture(data.picture)
    if (!welcome(peerId, name, picture)) return
    if (seen.has(id)) return
    const message = { id, name, text, admin: false, picture, at: cleanAt(data.at) }
    remember(message)
    relay(message)
    if (isNew) sendLog(peerId)
  }

  function remember(message) {
    seen.add(message.id)
    messages.push(message)
    while (messages.length > MAX_LOG) {
      const old = messages.shift()
      seen.delete(old.id)
      log.querySelector(`[data-id="${CSS.escape(old.id)}"]`)?.remove()
    }
    log.append(renderMessage(message))
    empty.hidden = true
    scroll.scrollTop = scroll.scrollHeight
  }

  function addNotice(text) {
    const item = document.createElement('li')
    item.className = 'chat-notice'
    item.textContent = text
    log.append(item)
    empty.hidden = true
    scroll.scrollTop = scroll.scrollHeight
  }

  function relay(message) {
    action?.send({
      kind: 'said',
      id: message.id,
      name: message.name,
      text: message.text,
      admin: message.admin,
      picture: message.picture,
      at: message.at
    }).catch(() => {})
  }

  function sendLog(peerId) {
    action?.send({
      kind: 'log',
      messages: messages.map(({ id, name, text, admin, picture, at }) => ({ id, name, text, admin, picture, at }))
    }, { target: peerId }).catch(() => {})
  }

  function renderPeople() {
    peopleEl.replaceChildren()
    if (people.size === 0) {
      const emptyPeople = document.createElement('p')
      emptyPeople.className = 'chat-empty'
      emptyPeople.textContent = 'Nobody has joined yet.'
      peopleEl.append(emptyPeople)
      return
    }
    for (const person of people.values()) {
      const row = document.createElement('div')
      row.className = 'chat-person'
      const face = document.createElement('span')
      face.className = 'chat-picture'
      face.append(pictureElement(person.picture))
      const label = document.createElement('span')
      label.className = 'chat-person-label'
      label.textContent = person.name
      row.append(face, label)
      peopleEl.append(row)
    }
  }
}

function renderMessage(message) {
  const item = document.createElement('li')
  item.className = message.admin ? 'chat-msg admin' : 'chat-msg'
  item.dataset.id = message.id

  const face = document.createElement('span')
  face.className = 'chat-picture'
  face.append(pictureElement(message.admin ? 'studio' : message.picture))

  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble'

  const who = document.createElement('span')
  who.className = 'chat-name'
  who.append(document.createTextNode(message.admin ? STUDIO_NAME : message.name))
  if (message.admin) {
    const badge = document.createElement('span')
    badge.className = 'chat-badge'
    badge.textContent = 'Admin'
    who.append(badge)
  }

  const time = document.createElement('time')
  time.className = 'chat-time'
  time.dateTime = new Date(message.at).toISOString()
  time.textContent = formatTime(message.at)

  const head = document.createElement('span')
  head.className = 'chat-head'
  head.append(who, time)

  const body = document.createElement('p')
  body.className = 'chat-text'
  body.textContent = message.text
  bubble.append(head, body)
  item.append(face, bubble)
  return item
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = cleanId(raw.id)
  const text = cleanText(raw.text)
  const admin = Boolean(raw.admin)
  const name = admin ? STUDIO_NAME : cleanName(raw.name)
  if (!id || !text || !name) return null
  return { id, name, text, admin, picture: admin ? 'studio' : cleanPicture(raw.picture), at: cleanAt(raw.at) }
}

function cleanAt(value) {
  const at = Number(value)
  if (!Number.isFinite(at) || at < 1577836800000 || at > Date.now() + 60000) return Date.now()
  return Math.round(at)
}

function formatTime(at) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at)
}

function cleanName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24)
  if (!name || name.toLowerCase() === 'studio') return ''
  return name
}

function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 280)
}

function cleanId(value) {
  const id = String(value ?? '')
  return /^[\w-]{8,40}$/.test(id) ? id : ''
}

function makeId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
