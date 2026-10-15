import type { Message, ProviderRequest } from '@orkestrel/agent'
import type { StudyAgentSummaryOptions } from './types.js'
import { cloneJSONValue, isJSONValue } from '@orkestrel/contract'
import { StudyError } from '../../core/errors.js'
import { projectStudyAgentRequest, validateStudyAgentUsage } from '../../core/agents/helpers.js'

/** Folds a conversation through the real provider under an explicit gauge and prompt limit. */
export class StudyAgentSummary {
	readonly #options: StudyAgentSummaryOptions

	/** Binds the provider, the measuring trace, the gauge, the limit and the consumer's instruction.
	 * @param options - Delegate, measurement seam, limits and cancellation.
	 */
	constructor(options: StudyAgentSummaryOptions) {
		this.#options = { ...options }
	}

	/** Measures one canonical request, refuses it at the limit, and sends the very same array to the provider.
	 * @param messages - The conversation to fold; the instruction follows as the final user turn.
	 * @param signal - Bounds the request; the options' signal bounds it when omitted.
	 * @returns The summary content, retained as evidence before a blank result is refused.
	 * @throws StudyError - Thrown with code `CAPACITY` when the projection reaches the limit, and with code `FAULT` when usage is unusable, no goal is active, or the content is blank.
	 */
	async summarize(messages: readonly Message[], signal: AbortSignal | undefined): Promise<string> {
		const { provider, runtime, trace, latch, gauge, limit, instruction } = this.#options
		const bound = signal ?? this.#options.signal
		bound.throwIfAborted()
		latch.check()
		// One canonical array: measured once, admitted or refused, then sent as the very same array. The
		// instruction is the final user turn, so the chat template opens a fresh reply instead of
		// continuing the last folded assistant message.
		const canonical: readonly Message[] = [...messages, instruction]
		const request: ProviderRequest = { messages: canonical }
		const estimate = runtime.estimateRequest(request)
		const projected = projectStudyAgentRequest(gauge, estimate)
		const reading = { estimate, projected }
		if (projected >= limit) {
			const message = 'Summary request projection reaches the summary room'
			// The refusal keeps its own admission, so the Agent's admission stays the one a later window refusal names.
			const stamp = trace.measure('admission', 'summary', request, reading, undefined)
			if (stamp !== undefined)
				trace.append('refusal', {
					cause: 'capacity',
					role: 'summary',
					ordinal: stamp.ordinal,
					revision: stamp.revision,
					consumed: projected,
					max: limit,
				})
			throw new StudyError('CAPACITY', message, { cause: 'capacity', message, role: 'summary' })
		}
		trace.dispatch('summary', request, reading)
		const result = await provider.generate(canonical, bound)
		if (!bound.aborted) validateStudyAgentUsage(result.usage, 'summary')
		latch.check()
		if (trace.goal === undefined || typeof result.content !== 'string')
			throw new StudyError('FAULT', 'Summary outside an active goal or invalid content')
		const value: unknown = {
			sources: messages.map((message) => message.id),
			content: result.content,
		}
		if (!isJSONValue(value)) throw new StudyError('FAULT', 'Summary evidence is not JSON')
		trace.append('summary', cloneJSONValue(value))
		if (result.content.trim() === '') {
			const message = 'Summary returned no usable content'
			throw new StudyError('FAULT', message, { cause: 'content', message, role: 'summary' })
		}
		return result.content
	}
}
