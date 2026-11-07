const secrets = new Set<string>()
export function rememberSecret(value: string | null | undefined) {
  if (value) secrets.add(value)
}
rememberSecret(process.env.OPENAI_API_KEY)
export function redactSecrets(text: string) {
  for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]')
  return text
}
export function secretStream() {
  let pending = ''
  return (text: string, end = false) => {
    pending += text
    let cut = end
      ? pending.length
      : Math.max(0, pending.length - Math.max(1, ...[...secrets].map((s) => s.length)) + 1)
    for (const secret of secrets) {
      let index = pending.indexOf(secret)
      while (index >= 0 && index < cut) {
        if (index + secret.length > cut) {
          cut = index
          break
        }
        index = pending.indexOf(secret, index + 1)
      }
    }
    const ready = redactSecrets(pending.slice(0, cut))
    pending = pending.slice(cut)
    return ready
  }
}
