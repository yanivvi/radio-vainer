import { suggestName } from './names.js'

const MAX_REQUESTS = 40
const REQUEST_HOLD_MS = 20000
const STUDIO_NAME = 'Studio'

// The studio keeps the list. Listeners ask for songs and upvote
// requests that someone else made.

export function mountListenerRequests({ room, getHostId, claimHost }) {
  const form = document.querySelector('#request-form')
  const nameInput = document.querySelector('#request-name')
  const songInput = document.querySelector('#request-song')
  const note = document.querySelector('#request-note')
  const empty = document.querySelector('#request-empty')
  const list = document.querySelector('#request-list')

  const action = room.makeAction('requests')
  let board = []
  let mine = new Set()
  let asked = new Set()
  const pending = new Set()
  let chatter = ''
  let announced = false
  let seenHost = false
  let holdTimer = 0

  nameInput.value = suggestName()

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const title = cleanTitle(songInput.value)
    const name = chatter || cleanRequestName(nameInput.value, false)
    if (!name) {
      setNote('Choose a name.')
      nameInput.focus()
      return
    }
    if (!title) return
    if (!getHostId()) {
      setNote('The studio is not here yet.')
      return
    }
    setNote('')
    const id = makeId()
    pending.add(id)
    songInput.value = ''
    action.send({ kind: 'ask', id, title, name }).catch(() => {
      pending.delete(id)
      songInput.value = title
      paint()
      setNote('Could not send. Try again.')
    })
  })

  action.onMessage = (data, { peerId }) => {
    if (!data || typeof data !== 'object') return
    if (!claimHost(peerId)) return
    if (data.kind === 'board') {
      replaceBoard(data.requests)
      paint()
      return
    }
    if (data.kind === 'state') {
      replaceBoard(data.requests)
      applyYours(data.mine, data.asked)
      paint()
    }
  }

  return {
    hostHere() {
      window.clearTimeout(holdTimer)
      holdTimer = 0
      seenHost = true
      if (announced) return
      setNote('')
      sendHello()
    },
    hostLeft(immediate) {
      announced = false
      window.clearTimeout(holdTimer)
      holdTimer = 0
      setNote(seenHost ? 'The studio left. Requests return when it is back.' : 'Waiting for the studio.')
      if (immediate) wipe()
      else holdTimer = window.setTimeout(wipe, REQUEST_HOLD_MS)
    },
    setName(name) {
      chatter = cleanRequestName(name, false)
      if (chatter) {
        nameInput.value = chatter
        nameInput.disabled = true
      } else {
        nameInput.disabled = false
      }
    }
  }

  function sendHello() {
    if (!getHostId()) return
    announced = true
    action.send({ kind: 'hello' }).catch(() => {
      announced = false
    })
  }

  function vote(id) {
    if (asked.has(id) || pending.has(id)) return
    if (!getHostId()) {
      setNote('The studio is not here yet.')
      return
    }
    const up = !mine.has(id)
    if (up) mine.add(id)
    else mine.delete(id)
    paint()
    action.send({ kind: 'vote', id, up }).catch(() => {
      if (up) mine.delete(id)
      else mine.add(id)
      paint()
      setNote('Could not send. Try again.')
    })
  }

  function replaceBoard(incoming) {
    const next = []
    const ids = new Set()
    const rows = Array.isArray(incoming) ? incoming : []
    for (const raw of rows.slice(0, MAX_REQUESTS)) {
      const request = normalize(raw)
      if (!request || ids.has(request.id)) continue
      ids.add(request.id)
      next.push(request)
    }
    board = next
    mine = new Set([...mine].filter((id) => ids.has(id)))
    asked = new Set([...asked].filter((id) => ids.has(id)))
  }

  function applyYours(mineIds, askedIds) {
    const known = new Set(board.map((item) => item.id))
    mine = new Set(cleanIdList(mineIds).filter((id) => known.has(id)))
    asked = new Set(cleanIdList(askedIds).filter((id) => known.has(id)))
    for (const id of asked) pending.delete(id)
    for (const id of [...pending]) {
      if (known.has(id) && !asked.has(id)) pending.delete(id)
    }
  }

  function paint() {
    const ranked = [...board].sort(byRank)
    list.replaceChildren()
    for (const request of ranked) {
      list.append(renderRequest(request, {
        own: asked.has(request.id) || pending.has(request.id),
        voted: mine.has(request.id),
        onVote: vote
      }))
    }
    empty.hidden = ranked.length > 0
  }

  function wipe() {
    holdTimer = 0
    board = []
    mine = new Set()
    asked = new Set()
    pending.clear()
    paint()
  }

  function setNote(message) {
    note.textContent = message
  }
}

export function mountStudioRequests() {
  const live = document.querySelector('#studio-requests-live')
  const note = document.querySelector('#studio-requests-note')
  const form = document.querySelector('#studio-requests-form')
  const songInput = document.querySelector('#studio-request-song')
  const empty = document.querySelector('#studio-requests-empty')
  const list = document.querySelector('#studio-requests-list')

  let board = []
  const seen = new Set()
  const owners = new Map()
  const voteSets = new Map()
  let action = null

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!action) return
    const title = cleanTitle(songInput.value)
    if (!title) return
    acceptAsk('studio', { id: makeId(), title, name: STUDIO_NAME })
    songInput.value = ''
    songInput.focus()
  })

  return {
    attach(room) {
      action = room.makeAction('requests')
      live.hidden = false
      note.textContent = ''
      paint()
      action.onMessage = (data, { peerId }) => {
        if (!data || typeof data !== 'object') return
        if (data.kind === 'hello') sendState(peerId)
        else if (data.kind === 'ask') acceptAsk(peerId, data)
        else if (data.kind === 'vote') setVote(peerId, cleanId(data.id), data.up === true)
      }
    },
    detach() {
      action = null
      board = []
      seen.clear()
      owners.clear()
      voteSets.clear()
      list.replaceChildren()
      songInput.value = ''
      empty.hidden = false
      live.hidden = true
      note.textContent = 'Go live to take requests.'
    },
    peerLeft(peerId) {
      let changed = false
      for (const votes of voteSets.values()) {
        if (votes.delete(peerId)) changed = true
      }
      if (changed) publish()
    }
  }

  function acceptAsk(peerId, data) {
    const name = peerId === 'studio' ? STUDIO_NAME : cleanRequestName(data.name, false)
    const title = cleanTitle(data.title)
    const id = cleanId(data.id)
    if (!name || !title || !id || seen.has(id)) return
    seen.add(id)
    owners.set(id, peerId)
    voteSets.set(id, new Set())
    board.push({ id, title, name, at: Date.now() })
    trimKeeping(id)
    if (peerId !== 'studio') sendState(peerId)
    publish()
  }

  function setVote(peerId, id, up) {
    if (!id || !board.some((item) => item.id === id)) return
    if (owners.get(id) === peerId) {
      if (peerId !== 'studio') sendState(peerId)
      return
    }
    let votes = voteSets.get(id)
    if (!votes) {
      votes = new Set()
      voteSets.set(id, votes)
    }
    if (up) votes.add(peerId)
    else votes.delete(peerId)
    if (peerId !== 'studio') sendState(peerId)
    publish()
  }

  function trimKeeping(keepId) {
    while (board.length > MAX_REQUESTS) {
      let index = -1
      for (let i = 0; i < board.length; i += 1) {
        if (board[i].id === keepId && board.length > 1) continue
        if (index === -1) {
          index = i
          continue
        }
        const votes = voteSets.get(board[i].id)?.size || 0
        const least = voteSets.get(board[index].id)?.size || 0
        if (votes < least || (votes === least && board[i].at < board[index].at)) index = i
      }
      if (index === -1) break
      const [old] = board.splice(index, 1)
      seen.delete(old.id)
      owners.delete(old.id)
      voteSets.delete(old.id)
    }
  }

  function publicRequests() {
    return board.map((request) => ({
      id: request.id,
      title: request.title,
      name: request.name,
      at: request.at,
      votes: voteSets.get(request.id)?.size || 0
    }))
  }

  function sendState(peerId) {
    if (!action || !peerId || peerId === 'studio') return
    const mine = []
    const asked = []
    for (const request of board) {
      if (owners.get(request.id) === peerId) asked.push(request.id)
      if (voteSets.get(request.id)?.has(peerId)) mine.push(request.id)
    }
    action.send({
      kind: 'state',
      requests: publicRequests(),
      mine,
      asked
    }, { target: peerId }).catch(() => {})
  }

  function publish() {
    paint()
    action?.send({ kind: 'board', requests: publicRequests() }).catch(() => {})
  }

  function paint() {
    const ranked = publicRequests().sort(byRank)
    list.replaceChildren()
    for (const request of ranked) {
      list.append(renderRequest(request, {
        own: owners.get(request.id) === 'studio',
        voted: voteSets.get(request.id)?.has('studio') || false,
        onVote(id) {
          setVote('studio', id, !voteSets.get(id)?.has('studio'))
        }
      }))
    }
    empty.hidden = ranked.length > 0
  }
}

function renderRequest(request, { own, voted, onVote }) {
  const item = document.createElement('li')
  item.className = 'request'

  if (own) {
    const yours = document.createElement('span')
    yours.className = 'request-yours'
    yours.textContent = 'Yours'
    item.append(yours)
  } else {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'request-vote'
    button.textContent = voted ? 'Upvoted' : 'Upvote'
    button.setAttribute('aria-pressed', voted ? 'true' : 'false')
    button.setAttribute('aria-label', `${voted ? 'Remove upvote from' : 'Upvote'} ${request.title}`)
    button.addEventListener('click', () => { onVote(request.id) })
    item.append(button)
  }

  const count = document.createElement('span')
  count.className = 'request-votes'
  count.textContent = String(request.votes || 0)

  const title = document.createElement('span')
  title.className = 'request-title'
  title.textContent = request.title

  const by = document.createElement('span')
  by.className = 'request-by'
  by.textContent = request.name

  item.append(count, title, by)
  return item
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = cleanId(raw.id)
  const title = cleanTitle(raw.title)
  const name = cleanRequestName(raw.name, true)
  if (!id || !title || !name) return null
  const votes = Math.round(Number(raw.votes))
  return {
    id,
    title,
    name,
    at: cleanAt(raw.at),
    votes: Number.isFinite(votes) && votes > 0 ? Math.min(999, votes) : 0
  }
}

function byRank(a, b) {
  if (b.votes !== a.votes) return b.votes - a.votes
  return a.at - b.at
}

function cleanRequestName(value, allowStudio) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24)
  if (!name) return ''
  if (name.toLowerCase() === 'studio') return allowStudio ? STUDIO_NAME : ''
  return name
}

function cleanTitle(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80)
}

function cleanAt(value) {
  const at = Number(value)
  if (!Number.isFinite(at) || at < 1577836800000 || at > Date.now() + 60000) return Date.now()
  return Math.round(at)
}

function cleanId(value) {
  const id = String(value ?? '')
  return /^[\w-]{8,40}$/.test(id) ? id : ''
}

function cleanIdList(value) {
  if (!Array.isArray(value)) return []
  const ids = []
  for (const item of value) {
    const id = cleanId(item)
    if (id) ids.push(id)
    if (ids.length >= MAX_REQUESTS) break
  }
  return ids
}

function makeId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `r${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`.slice(0, 40)
}
