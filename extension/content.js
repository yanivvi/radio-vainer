const input = document.querySelector('#title')
if (input) {
  let lastSent = ''
  let paused = false

  input.addEventListener('input', (event) => {
    if (!event.isTrusted) return
    paused = input.value.trim() !== lastSent
  })

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'now-playing') return
    const title = String(msg.title || '').trim()
    if (!title) return
    const changed = title !== lastSent
    lastSent = title
    if (!changed && (paused || input.value.trim() === title)) return
    paused = false
    input.value = title
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  chrome.runtime.sendMessage({ type: 'ready' })
}
