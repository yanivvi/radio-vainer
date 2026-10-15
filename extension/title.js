export function cleanTabTitle(label) {
  let name = String(label || '').replace(/\s+/g, ' ').trim()
  name = name.replace(/^\(\d+\)\s+/, '')
  name = name.replace(/^(?:YouTube|Spotify)\s+[-–—]\s+/i, '').trim()
  name = name.replace(/\s+(?:[-|–—]|·)\s+(?:YouTube Music|YouTube|Spotify|SoundCloud|Apple Music|Bandcamp|Tidal|Deezer|Google Chrome|Chrome)$/i, '').trim()
  if (!name || /^(youtube|spotify|web player|new tab|studio · radio vainer|on air · radio vainer)$/i.test(name.replace(/^●\s*/, ''))) {
    return ''
  }
  return name.slice(0, 80)
}
