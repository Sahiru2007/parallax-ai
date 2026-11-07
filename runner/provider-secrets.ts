const secrets = new Set<string>()
export function rememberSecret(value: string | null | undefined) {
  if (value) secrets.add(value)
}
rememberSecret(process.env.OPENAI_API_KEY)
rememberSecret(process.env.GEMINI_API_KEY)
rememberSecret(process.env.GOOGLE_API_KEY)
export function redactSecrets(text: string) {
  for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]')
  return text
}
export function secretStream() {
  let pending = ''
  return (text: string, end = false) => {
    pending += text
    // Hold only suffixes that could be the beginning of a secret. Ordinary short
    // output (including ready/approval markers from long-running commands) must stream now.
    let cut = pending.length
    if (!end)
      for (const secret of secrets) {
        for (let size = Math.min(secret.length - 1, pending.length); size > 0; size--) {
          if (pending.endsWith(secret.slice(0, size))) {
            cut = Math.min(cut, pending.length - size)
            break
          }
        }
      }
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
