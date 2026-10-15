import type { JSONValue } from '@orkestrel/contract'
import type { LedgerGauge, ProviderResult, RequestMeasure } from '@orkestrel/agent'
import type { StudyRole } from '../types.js'
import type { StudyAgentDispatch, StudyAgentRuntime } from './types.js'
import { StudyError } from '../errors.js'

/**
 * Prices a runtime estimate through an explicit gauge.
 * @param gauge - The declared scale and overhead
 * @param estimate - The runtime's estimate of one complete request
 * @returns The projected prompt tokens, rounded up
 */
export function projectStudyAgentRequest(gauge: LedgerGauge, estimate: number): number {
	return Math.ceil(gauge.overhead + gauge.scale * estimate)
}

/**
 * Checks that a successful provider call reported a usable actual prompt count.
 * @remarks
 * The check compares nothing with a forecast; room enforcement stays with the transport.
 * @param usage - The usage a successful provider call reported
 * @param role - The responsibility whose request was dispatched; the failure retains it
 * @returns Nothing when the prompt count is finite and positive
 * @throws StudyError - Thrown with code `FAULT` when the prompt count is missing, not finite, or not positive
 */
export function validateStudyAgentUsage(usage: ProviderResult['usage'], role: StudyRole): void {
	const prompt = usage?.prompt
	if (typeof prompt !== 'number' || !Number.isFinite(prompt) || prompt <= 0) {
		const message = 'Gauged request returned no usable prompt count'
		throw new StudyError('FAULT', message, { cause: 'infrastructure', message, role })
	}
}

/**
 * Translates only a nominal Agent window refusal into the attributable capacity failure.
 * @param error - The caught or reported value
 * @param runtime - The admitted Agent namespace owning the nominal guard
 * @returns A capacity StudyError for an Agent `WINDOW` error; every other value with its identity
 */
export function translateStudyAgentError(
	error: unknown,
	runtime: Pick<StudyAgentRuntime, 'isAgentError'>,
): unknown {
	if (!runtime.isAgentError(error) || error.code !== 'WINDOW') return error
	return new StudyError('CAPACITY', error.message, {
		cause: 'capacity',
		message: error.message,
		role: 'agent',
	})
}

/**
 * Projects a request's structural components onto plain JSON without storing a total.
 * @param measure - The runtime's disjoint per-message, tools and schema estimates
 * @returns The same components in request order
 */
export function buildStudyAgentParts(measure: RequestMeasure): JSONValue {
	return {
		messages: measure.messages.map((message) => ({
			id: message.id,
			role: message.role,
			content: message.content,
			framing: message.framing,
			calls: message.calls,
			thinking: message.thinking,
			images: message.images,
		})),
		tools: measure.tools,
		schema: measure.schema,
	}
}

/**
 * Builds the evidence join of a wire request to its canonical dispatch.
 * @param dispatch - The measured dispatch, or undefined when the caller measured none
 * @returns The dispatch id and revision, each null when unknown
 */
export function buildStudyAgentDispatch(
	dispatch: StudyAgentDispatch | undefined,
): Readonly<Record<string, JSONValue>> {
	return { canonical: dispatch?.id ?? null, revision: dispatch?.revision ?? null }
}
