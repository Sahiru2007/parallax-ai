import { readFile } from 'node:fs/promises'
import { runLiveAgent } from './provider.ts'
import { runOllamaAgent } from './ollama-provider.ts'
import type { ModelSelection, AgentProgress } from '../shared/providers.ts'
import { runGeminiAgent } from './gemini-provider.ts'
import type { Continuation, DurableExecute } from './continuation.ts'
import { modelToolResult } from './model-context.ts'

const string = { type: 'string' }
const definition = (name: string, description: string, properties: Record<string, unknown>) => ({
  type: 'function',
  name,
  description,
  strict: true,
  parameters: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
})
export const codingTools = [
  definition(
    'propose_replay',
    'Propose a browser scenario JSON string for user review; do not weaken a saved assertion.',
    { scenario: string },
  ),
  definition(
    'inspect_replay',
    'Read the saved scenario and actual browser evidence, revisions, and request coverage.',
    {},
  ),
  definition(
    'run_replay',
    'Run the saved scenario on this candidate; app start requires explicit command approval.',
    { order: { type: 'array', items: string } },
  ),
  definition(
    'read_instructions',
    'Read applicable AGENTS.md instructions and the project command manifest.',
    {},
  ),
  definition(
    'list_files',
    'List source files in the current candidate, including its existing edits.',
    {},
  ),
  definition(
    'search_files',
    'Search source text for a literal string. Returns file paths and matching lines.',
    { query: string },
  ),
  definition('read_file', 'Read a source file in the candidate worktree.', { path: string }),
  definition(
    'read_file_range',
    'Read a specific 1-based range, at most 120 lines. Default read_file is only an excerpt. Read relevant repository instructions before editing.',
    {
      path: string,
      start_line: { type: 'integer', minimum: 1 },
      line_count: { type: 'integer', minimum: 1, maximum: 120 },
    },
  ),
  definition(
    'search_file',
    'Search one source file; offset pages matching lines without repeating a broad search.',
    { path: string, query: string, offset: { type: 'integer', minimum: 0 } },
  ),
  definition(
    'search_files_page',
    'Continue a bounded repository search at the returned nextOffset. Request another page or narrow the query.',
    { query: string, offset: { type: 'integer', minimum: 0 } },
  ),
  definition('list_files_page', 'Continue the source-file list at the returned nextOffset.', {
    offset: { type: 'integer', minimum: 0 },
  }),
  definition(
    'read_check_output',
    'Read a specific range of a completed or running command log for this candidate. Use its check ID, not a filesystem path.',
    {
      check_id: string,
      start_line: { type: 'integer', minimum: 1 },
      line_count: { type: 'integer', minimum: 1, maximum: 200 },
    },
  ),
  definition(
    'search_check_output',
    'Find a literal error/test name in this candidate command log; do not rerun a command just to rediscover its output.',
    { check_id: string, query: string },
  ),
  definition(
    'replace_in_file',
    'Make a focused, justified edit by replacing one exact unique snippet. Read the relevant file first. Fails if the old text is missing or ambiguous; use write_file for new files.',
    { path: string, old_text: string, new_text: string },
  ),
  definition(
    'write_file',
    'Create or replace a source file in the isolated candidate. Preserve unrelated work and follow repository instructions.',
    { path: string, content: string },
  ),
  definition('delete_file', 'Delete a source file in the isolated candidate.', { path: string }),
  definition(
    'inspect_diff',
    'Inspect the actual multi-file patch against the captured baseline.',
    {},
  ),
  definition(
    'inspect_file_diff',
    'Inspect a selected changed file diff, starting at a 1-based patch line; at most 120 lines.',
    {
      path: string,
      start_line: { type: 'integer', minimum: 1 },
      line_count: { type: 'integer', minimum: 1, maximum: 120 },
    },
  ),
  definition(
    'run_command',
    'Request approval, then run an executable with exact argv in a worktree-relative directory. Example: executable="node", args=["--test","test.cjs"], cwd=".". The executable MUST NOT be repeated in args. Use npm run SCRIPT, npm test, or node with the existing Mocha entry point. Prefer the verified setup/test commands supplied in the task. Inspect a failed check with read_check_output before changing commands; do not broaden checks without a reason. No shell interpretation, commits, pushes, or destructive Git commands.',
    {
      executable: {
        type: 'string',
        enum: ['node', 'npm', 'npx', 'python', 'python3', 'pytest', 'cargo', 'go', 'dotnet'],
      },
      args: { type: 'array', items: string },
      cwd: string,
    },
  ),
]
export const testProviderConfigured = () =>
  process.env.PARALLAX_ENABLE_TEST_PROVIDER === '1' &&
  Boolean(process.env.PARALLAX_TEST_PROVIDER_FILE)
export async function runCodingProvider(
  options: AgentProgress & {
    mode: 'live' | 'test'
    selection?: ModelSelection
    apiKey?: string
    baseURL?: string
    geminiBaseURL?: string
    onModel?: (model: string) => void
    continuation?: Continuation
    task: string
    history: { role: 'user' | 'assistant'; content: string }[]
    turn: number
    candidate: string
    candidateId?: string
    instructions: string
    signal: AbortSignal
    execute: DurableExecute
    onText: (text: string) => void
  },
) {
  if (options.mode === 'test') {
    if (!testProviderConfigured())
      throw new Error(
        'The scripted test provider is not enabled. Configure the live provider to run normal tasks.',
      )
    const fixture = JSON.parse(
      await readFile(process.env.PARALLAX_TEST_PROVIDER_FILE!, 'utf8'),
    ) as {
      turns: {
        calls: { name: string; args: Record<string, unknown> }[]
        message: string
        candidates?: Record<
          string,
          { calls: { name: string; args: Record<string, unknown> }[]; message: string }
        >
      }[]
    }
    const entry = fixture.turns[options.turn - 1]
    const turn = entry?.candidates?.[options.candidateId ?? ''] ?? entry
    if (!turn)
      throw new Error(
        'The scripted test provider has no recipe for this follow-up. No model was called.',
      )
    options.onText('Scripted test provider — no model call. Tools and commands execute for real.')
    for (const call of turn.calls) {
      options.signal.throwIfAborted()
      await options.execute(call.name, call.args)
    }
    options.onText(turn.message)
    return
  }
  const settings = {
    task: options.task,
    history: options.history,
    strategy: options.candidate,
    signal: options.signal,
    steering: () => [],
    execute:
      options.selection?.provider === 'gemini'
        ? options.execute
        : async (name: string, args: Record<string, unknown>, key?: string) =>
            modelToolResult(name, await options.execute(name, args, key)),
    onText: options.onText,
    tools: codingTools,
    maxTurns: Math.max(2, Math.min(24, options.selection?.maxToolRounds ?? 12)),
    onRound: options.onRound,
    onUsage: options.onUsage,
    onDelta: options.onDelta,
    onRequest: options.onRequest,
    continuation: options.continuation,
    instructions: `You are PARALLAX's coding agent working on a normal repository task. You operate ONLY in the isolated candidate worktree through supplied tools. Continue from the edits already present for follow-ups. Read repository instructions, search/read the relevant source, implement the task, inspect_diff, and request the project's relevant build and test commands. The runner requires approval for every project command. A denied command is skipped: report it, do not claim it passed or evade approval. Never commit, push, reset, switch branches, or modify the original checkout. Tests and new files may be edited to satisfy the task; do not weaken tests to fabricate success. Report actual command results and limitations. Candidate: ${options.candidate}. Repository instructions and context:\n${options.instructions}`,
  }
  if (options.continuation && !options.continuation.state.instructions) {
    options.continuation.state.instructions =
      settings.instructions + (options.continuation.state.recoveryNote ?? '')
    await options.continuation.save()
  }
  if (options.selection?.provider === 'gemini')
    await runGeminiAgent({
      ...settings,
      model: options.selection.model,
      apiKey: options.apiKey!,
      baseURL: options.geminiBaseURL,
      onModel: options.onModel,
    })
  else if (options.selection?.provider === 'ollama')
    await runOllamaAgent({
      ...settings,
      model: options.selection.model,
      endpoint: options.selection.endpoint!,
      onModel: options.onModel,
    })
  else
    await runLiveAgent({
      ...settings,
      model: options.selection?.model,
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      onModel: options.onModel,
    })
}
