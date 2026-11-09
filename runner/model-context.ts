import type { RequestSize } from '../shared/providers.ts'

// These are model budgets, not storage/UI limits. Provider-native model parts,
// opaque signatures, call IDs, user tasks and repository instructions stay intact.
export const modelLimits = { result: 6000, oldResult: 900, fileLines: 120, search: 40 }
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
export const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v) ?? 'null', 'utf8')
export function clip(text: string, limit: number) {
  limit = Math.max(0, limit)
  return text.length <= limit
    ? text
    : text.slice(0, limit) + '\n[Excerpt ends; request a specific range.]'
}
export function sourceRange(text: string, start: number, count: number) {
  const lines = text.split('\n')
  if (start > lines.length) throw new Error(`start_line exceeds this file's ${lines.length} lines.`)
  let content = '',
    endLine = start - 1,
    partial = false
  for (let index = start - 1; index < Math.min(lines.length, start - 1 + count); index++) {
    const line = lines[index]
    const separator = endLine >= start ? '\n' : ''
    if (separator && content.length + line.length + 1 > 5000) break
    content += separator + clip(line, 5000)
    endLine = index + 1
    if (line.length > 5000) {
      partial = true
      break
    }
  }
  return {
    startLine: start,
    endLine,
    totalLines: lines.length,
    content,
    partialLine: partial,
    truncated: start > 1 || endLine < lines.length || partial,
    nextStartLine: partial ? endLine : endLine < lines.length ? endLine + 1 : undefined,
  }
}
export function commandSummary(text: string) {
  const stats = /"stats"\s*:\s*(\{[^{}]{0,3000}\})/.exec(text.slice(0, 16_000))
  let summary: unknown
  try {
    if (stats) {
      const s = JSON.parse(stats[1])
      summary = Object.fromEntries(
        ['tests', 'passes', 'failures', 'pending', 'duration']
          .filter((k) => typeof s[k] === 'number')
          .map((k) => [k, s[k]]),
      )
    }
  } catch {
    /* Non-JSON test output remains an excerpt, never invented evidence. */
  }
  const useful = text
    .split('\n')
    .filter((line) =>
      /(?:^not ok\b|^# (?:tests|pass|fail|skipped|duration)|\b(?:Error:|ERR!|FAIL |passing|failing)\b)/.test(
        line,
      ),
    )
    .slice(0, 12)
    .map((line) => clip(line, 250))
  return { ...(summary ? { testStats: summary } : {}), highlights: useful }
}
export function modelToolResult(name: string, value: unknown, limit = modelLimits.result): unknown {
  const r = record(value)
  if (name === 'run_command' && ('output' in r || 'id' in r)) {
    const output = String(r.output ?? r.outputExcerpt ?? '')
    const excerptSize = Math.max(128, Math.min(1800, limit - 1200))
    return {
      id: r.id,
      status: r.status,
      exitCode: r.exitCode,
      digest: r.digest,
      command: clip(String(r.command ?? ''), 1000),
      ...record(
        r.modelSummary ??
          (r.testStats
            ? { testStats: r.testStats, highlights: r.highlights }
            : commandSummary(output)),
      ),
      outputExcerpt:
        clip(output.slice(0, Math.min(700, excerptSize)), excerptSize) +
        (output.length > excerptSize
          ? '\n[... middle omitted ...]\n' + output.slice(-excerptSize)
          : ''),
      outputChars: r.outputChars ?? output.length,
      ...(r.progressNote ? { progressNote: r.progressNote } : {}),
      readMore:
        'read_check_output(check_id, start_line, line_count) or search_check_output(check_id, query); complete output is available in the UI.',
    }
  }
  if (typeof value === 'string') return clip(value, limit)
  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (const entry of value) {
      const bounded = typeof entry === 'string' ? clip(entry, 300) : entry
      if (items.length >= modelLimits.search || jsonBytes([...items, bounded]) > limit - 400) break
      items.push(bounded)
    }
    return items.length === value.length
      ? items
      : {
          items,
          total: value.length,
          truncated: true,
          readMore: 'Narrow the query/path or request the next offset.',
        }
  }
  if (jsonBytes(value) <= limit) return value
  if (typeof r.content === 'string') {
    let excerpt = r.content.slice(0, Math.max(128, limit - 1500))
    const lastBreak = excerpt.lastIndexOf('\n')
    const partialLine = lastBreak < 0
    if (!partialLine) excerpt = excerpt.slice(0, lastBreak)
    const endLine =
      typeof r.startLine === 'number' ? r.startLine + excerpt.split('\n').length - 1 : undefined
    return {
      ...r,
      content: excerpt + '\n[Compacted excerpt; request a specific range.]',
      truncated: true,
      excerptCompacted: true,
      ...(typeof r.endLine === 'number' && endLine !== undefined
        ? {
            originalEndLine: r.endLine,
            endLine,
            partialLine,
            nextStartLine: partialLine ? endLine : endLine + 1,
          }
        : {}),
    }
  }
  return {
    excerpt: clip(JSON.stringify(value), limit),
    truncated: true,
    readMore: 'Request a specific file range, diff or check excerpt.',
  }
}

// Retain the entire provider-required call/response sequence. Only our own tool
// result bodies are projected; model parts/signatures are never edited or merged.
export function geminiContext(contents: unknown[]) {
  const responses = contents
    .flatMap((v) => (record(v).parts as unknown[] | undefined) ?? [])
    .map(record)
    .filter((p) => p.functionResponse).length
  let index = 0
  return contents.map((v) => {
    const turn = record(v)
    if (!Array.isArray(turn.parts)) return v
    return {
      ...turn,
      parts: turn.parts.map((part: unknown) => {
        const p = record(part),
          fr = record(p.functionResponse)
        if (!p.functionResponse) return part
        const old = index++ < responses - 3
        return {
          ...p,
          functionResponse: {
            ...fr,
            response: {
              ...record(fr.response),
              result: modelToolResult(
                String(fr.name),
                record(fr.response).result,
                old ? modelLimits.oldResult : modelLimits.result,
              ),
            },
          },
        }
      }),
    }
  })
}
// Only counts and fixed category names are diagnostic data. No paths, commands,
// source, hashes of source, signatures, headers or credentials are logged.
export function measureGeminiRequest(body: string, round: number): RequestSize {
  const request = JSON.parse(body),
    toolBytes = { files: 0, search: 0, commands: 0, other: 0 }
  let modelBytes = 0,
    userBytes = 0,
    toolResponses = 0
  for (const turn of request.contents ?? [])
    for (const part of turn.parts ?? []) {
      if (part.functionResponse) {
        const name = part.functionResponse.name as string
        const category = ['read_file', 'read_file_range'].includes(name)
          ? 'files'
          : [
                'search_files',
                'search_files_page',
                'search_file',
                'list_files',
                'list_files_page',
              ].includes(name)
            ? 'search'
            : ['run_command', 'read_check_output', 'search_check_output'].includes(name)
              ? 'commands'
              : 'other'
        toolBytes[category] += jsonBytes(part)
        toolResponses++
      } else if (turn.role === 'model') modelBytes += jsonBytes(part)
      else userBytes += jsonBytes(part)
    }
  return {
    round,
    bytes: Buffer.byteLength(body),
    systemBytes: jsonBytes(request.systemInstruction),
    schemaBytes: jsonBytes(request.tools),
    modelBytes,
    userBytes,
    toolBytes,
    toolResponses,
    messages: request.contents?.length ?? 0,
  }
}
