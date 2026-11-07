import { readFile } from 'node:fs/promises'
import { runLiveAgent } from './provider.ts'
import { runOllamaAgent } from './ollama-provider.ts'
import type { ModelSelection, AgentProgress } from '../shared/providers.ts'
import { runGeminiAgent } from './gemini-provider.ts'

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
    'run_command',
    'Request approval, then run an executable with exact argv in a worktree-relative directory. No shell interpretation. Use npm run for package scripts. Do not request commits, pushes, or destructive Git commands.',
    {
      executable: string,
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
    task: string
    history: { role: 'user' | 'assistant'; content: string }[]
    turn: number
    candidate: string
    candidateId?: string
    instructions: string
    signal: AbortSignal
    execute: (name: string, args: Record<string, unknown>) => Promise<unknown>
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
    execute: options.execute,
    onText: options.onText,
    tools: codingTools,
    maxTurns: Math.max(2, Math.min(24, options.selection?.maxToolRounds ?? 12)),
    onRound: options.onRound,
    onUsage: options.onUsage,
    onDelta: options.onDelta,
    instructions: `You are PARALLAX's coding agent working on a normal repository task. You operate ONLY in the isolated candidate worktree through supplied tools. Continue from the edits already present for follow-ups. Read repository instructions, search/read the relevant source, implement the task, inspect_diff, and request the project's relevant build and test commands. The runner requires approval for every project command. A denied command is skipped: report it, do not claim it passed or evade approval. Never commit, push, reset, switch branches, or modify the original checkout. Tests and new files may be edited to satisfy the task; do not weaken tests to fabricate success. Report actual command results and limitations. Candidate: ${options.candidate}. Repository instructions and context:\n${options.instructions}`,
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
