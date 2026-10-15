// Swap this for a name template when one is added.
export function suggestName() {
  const number = Math.floor(1000 + Math.random() * 9000)
  return `Listener ${number}`
}
