import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { clip, commandSummary } from './model-context.ts'

export async function checkExcerpt(file: string, start = 1, count = 60, query?: string) {
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(count) || count < 1 || count > 200)
    throw new Error('Use a positive start_line and line_count between 1 and 200.')
  let totalLines = 0,
    content = '',
    matched = 0
  const input = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      totalLines++
      if (
        query !== undefined
          ? line.includes(query)
          : totalLines >= start && totalLines < start + count
      ) {
        matched++
        if (matched <= count && content.length < 5000)
          content += `${totalLines}: ${clip(query ? line.slice(Math.max(0, line.indexOf(query) - 150)) : line, 500)}\n`
      }
    }
  } finally {
    lines.close()
    input.destroy()
  }
  return {
    startLine: start,
    totalLines,
    matched,
    content: clip(content, 5000),
    truncated: matched > count || content.length >= 5000,
  }
}
export async function summarizeCheck(file: string) {
  // Bounded head/tail for summaries even when the complete UI log is enormous.
  let head = '',
    tail = '',
    chars = 0
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    chars += chunk.length
    if (head.length < 16000) head = (head + chunk).slice(0, 16000)
    tail = (tail + chunk).slice(-16000)
  }
  return {
    outputChars: chars,
    modelSummary: commandSummary(chars <= 16000 ? head : head + '\n' + tail),
  }
}
