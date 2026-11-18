import type { StudyContext, StudyRole, StudyAgentRuntime } from '@src/core'
import type { JSONValue } from '@orkestrel/contract'
import type { Message, ProviderResult } from '@orkestrel/agent'

/** Names the model responsibility whose requests the trace measures. */
export type StudyAgentRole = Extract<StudyRole, 'agent'>

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
 * Holds the trace's measuring runtime and consumer origin join.
 * @remarks
 * `runtime` measures requests. `observe`: if `true`, the trace retains measurement rows; if
 * `false`, it retains none, while domain rows still follow an active goal. `origins` supplies the
 * consumer's origin annotation for a measured request's messages.
 */
export interface StudyAgentTraceOptions {
	readonly runtime: StudyAgentRuntime
	readonly observe: boolean
	readonly origins: StudyAgentOriginHandler
}

/**
 * Declares one scripted reply.
 * @remarks
 * `content` and `calls` are the reply the provider returns. `consume` names the prior tool result
 * the reply consumes; undefined consumes none. `abort`: if `true`, the reply aborts the goal's
 * workload; if `false` or undefined, it does not. `tokens` and `bytes` override the admitted
 * token count and byte charge of the reply; undefined keeps the defaults. `truncated`: if `true`,
 * the reply reports that the model ended it at its own token limit, which the Agent reads as a
 * `model` stop; if `false` or undefined, it does not.
 */
export interface StudyAgentResponse {
	readonly content: string
	readonly calls: NonNullable<ProviderResult['tools']>
	readonly consume: string | undefined
	readonly abort: boolean | undefined
	readonly tokens: number | undefined
	readonly bytes: number | undefined
	readonly truncated: boolean | undefined
}

/**
 * Holds the scripted provider's fixed byte bound and the model it reports.
 * @remarks
 * `bytes` bounds every served request and response, and is each response's default admitted
 * bytes; the admitted token count defaults to one. `model` names the model the provider reports
 * serving; it must be a non-empty string.
 */
export interface StudyAgentScriptOptions {
	readonly bytes: number
	readonly model: string
}

/** Holds one goal's scripted replies and the resources the provider charges and cancels through. */
export interface StudyAgentPlan {
	readonly responses: readonly StudyAgentResponse[]
	readonly goal: string
	readonly context: StudyContext
	readonly workload: AbortController
}
