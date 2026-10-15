import type { JSONValue } from '@orkestrel/contract'
import type { LedgerGauge, Message, ProviderInterface, ProviderResult } from '@orkestrel/agent'
import type { StudyContext, StudyRole } from '../../core/types.js'
import type { StudyAgentRuntime, StudyLatchInterface } from '../../core/agents/types.js'
import type { StudyAgentTrace } from './StudyAgentTrace.js'

/** Names the model responsibilities whose requests the trace and summary measure. */
export type StudyAgentRole = Extract<StudyRole, 'agent' | 'summary'>

/**
 * Names where a measurement was taken.
 * @remarks
 * `admission` is a window or room check before a request is admitted; `dispatch` is the request
 * the provider sends.
 */
export type StudyAgentStage = 'admission' | 'dispatch'

/**
 * Holds the ordinal and revision one measurement received.
 * @remarks
 * `revision` is null, never omitted, when the request could not be canonically rendered; the
 * retained evidence format distinguishes the two.
 */
export interface StudyAgentStamp {
	readonly ordinal: number
	readonly revision: string | null
}

/** Joins each message of a measured request to its origin, one JSON entry per message in order. */
export type StudyAgentOriginHandler = (messages: readonly Message[]) => JSONValue

/**
 * Holds the trace's measuring runtime, failure owner and consumer origin join.
 * @remarks
 * `runtime` measures requests and recognizes the nominal Agent refusal. `latch` retains the first
 * operational failure. `observe`: if `true`, the trace retains measurement and refusal rows; if
 * `false`, it retains none, while domain rows still follow an active goal. `origins` supplies the
 * consumer's origin annotation for a measured request's messages.
 */
export interface StudyAgentTraceOptions {
	readonly runtime: StudyAgentRuntime
	readonly latch: StudyLatchInterface
	readonly observe: boolean
	readonly origins: StudyAgentOriginHandler
}

/**
 * Holds the gauged summary's delegate, measurement seam, explicit limits and cancellation.
 * @remarks
 * `provider` receives the one canonical array the summary measured. `runtime` prices it. `trace`
 * retains the summary's measurement, refusal and evidence rows. `latch` refuses work after a
 * retained failure. `gauge` prices each request and `limit` is the prompt projection at which a
 * request is refused. `instruction` is the final user turn appended to the folded messages.
 * `signal` bounds work when the caller supplies none.
 */
export interface StudyAgentSummaryOptions {
	readonly provider: ProviderInterface
	readonly runtime: Pick<StudyAgentRuntime, 'estimateRequest'>
	readonly trace: StudyAgentTrace
	readonly latch: StudyLatchInterface
	readonly gauge: LedgerGauge
	readonly limit: number
	readonly instruction: Message
	readonly signal: AbortSignal
}

/**
 * Declares one scripted reply.
 * @remarks
 * `content` and `calls` are the reply the provider returns. `consume` names the prior tool result
 * the reply consumes; undefined consumes none. `cancel`: if `true`, the reply cancels the goal's
 * workload; if `false` or undefined, it does not. `tokens` and `bytes` override the admitted
 * token count and byte charge of the reply; undefined keeps the defaults.
 */
export interface StudyAgentResponse {
	readonly content: string
	readonly calls: NonNullable<ProviderResult['tools']>
	readonly consume: string | undefined
	readonly cancel: boolean | undefined
	readonly tokens: number | undefined
	readonly bytes: number | undefined
}

/** Holds the scripted provider's fixed byte bound; the admitted token count defaults to one. */
export interface StudyAgentScriptOptions {
	readonly bytes: number
}

/** Holds one goal's scripted replies and the resources the provider charges and cancels through. */
export interface StudyAgentPlan {
	readonly responses: readonly StudyAgentResponse[]
	readonly goal: string
	readonly context: StudyContext
	readonly workload: AbortController
}
