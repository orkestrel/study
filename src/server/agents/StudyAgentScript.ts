import type { Message, ProviderDelta, ProviderInterface, ProviderResult } from '@orkestrel/agent'
import type { StudyTicket } from '../../core/types.js'
import type { StudyAgentPlan, StudyAgentScriptOptions } from './types.js'
import { cloneJSONValue, isArray, isRecord } from '@orkestrel/contract'
import { randomUUID } from 'node:crypto'
import { StudyError } from '../../core/errors.js'
import { failStudyTicket } from '../../core/engines/helpers.js'
import { encodeStudyJSON } from '../helpers.js'
import { readStudyAgentMessages } from './helpers.js'
import { isStudyAgentResponse } from './validators.js'

/** Serves declared inert responses through the actual Agent provider boundary. */
export class StudyAgentScript implements ProviderInterface {
	readonly id = randomUUID()
	readonly name = 'scripted-study'
	readonly #bytes: number
	#plan: StudyAgentPlan | undefined
	#cursor = 0
	#running = false

	/**
	 * Binds the encoded byte bound every served request and response must fit.
	 * @param options - The explicit encoded bound; it is also each response's default admitted bytes
	 * @throws StudyError - Thrown when the bound is not a nonnegative safe integer
	 */
	constructor(options: StudyAgentScriptOptions) {
		if (!Number.isSafeInteger(options.bytes) || options.bytes < 0)
			throw new StudyError('CONFIG', 'Scripted byte bound must be a nonnegative safe integer')
		this.#bytes = options.bytes
	}

	/**
	 * Prepares one goal's declared response sequence and metered operational boundary.
	 * @param plan - The workload's responses and its operational context
	 * @returns Nothing when the provider is ready
	 * @throws StudyError - Thrown when a response is still running or a declared response is invalid
	 */
	prepare(plan: StudyAgentPlan): void {
		if (this.#running) throw new StudyError('CONFIG', 'Cannot replace a running scripted workload')
		if (!isArray(plan.responses) || !plan.responses.every(isStudyAgentResponse))
			throw new StudyError('CONFIG', 'Scripted response sequence is invalid')
		// Own the declared calls so later caller mutation cannot change a served response; the
		// clone is re-narrowed through the guard rather than asserted.
		const owned: unknown = plan.responses.map((response) => ({
			...response,
			calls: cloneJSONValue(response.calls),
		}))
		if (!isArray(owned) || !owned.every(isStudyAgentResponse))
			throw new StudyError('CONFIG', 'Scripted response sequence is invalid')
		this.#plan = { ...plan, responses: Object.freeze(owned) }
		this.#cursor = 0
	}

	/**
	 * Consumes the same streaming response into its assembled provider result.
	 * @param messages - The actual Agent conversation
	 * @param signal - The enclosing Agent run signal
	 * @returns The assembled declared response
	 */
	async generate(messages: readonly Message[], signal: AbortSignal): Promise<ProviderResult> {
		const stream = this.stream(messages, signal)
		let next = await stream.next()
		while (!next.done) next = await stream.next()
		return next.value
	}

	/**
	 * Streams a declared response after authoritative admission and retains actual request bytes.
	 * @param messages - The actual Agent conversation
	 * @param signal - The enclosing Agent run signal
	 * @returns The declared response, optionally consuming an actual prior tool message
	 * @remarks
	 * A stream abandoned after admission, for example by `return`, fails its admitted request with the
	 * run signal's reason, or a `FAULT` when the signal carries none, and never finishes it as success.
	 * @throws StudyError - Thrown when responses are exhausted or admission fails
	 */
	async *stream(
		messages: readonly Message[],
		signal: AbortSignal,
	): AsyncGenerator<ProviderDelta, ProviderResult> {
		const plan = this.#plan
		if (plan === undefined || this.#running)
			throw new StudyError('CONFIG', 'Scripted provider is unavailable')
		const response = plan.responses[this.#cursor]
		if (response === undefined)
			throw new StudyError('CONFIG', 'Scripted provider response sequence is exhausted')
		this.#cursor++
		this.#running = true
		let ticket: StudyTicket | undefined
		const started = performance.now()
		try {
			const request = readStudyAgentMessages(messages)
			let content = response.content
			if (response.consume !== undefined) {
				const prior = request.findLast(
					(message) =>
						isRecord(message) && message.role === 'tool' && message.call === response.consume,
				)
				if (!isRecord(prior) || typeof prior.content !== 'string')
					throw new StudyError('FAULT', 'Continuation has no actual referenced tool result')
				content = prior.content
			}
			const result: ProviderResult = {
				content,
				...(response.calls.length === 0 ? {} : { tools: response.calls }),
			}
			const bytes = encodeStudyJSON({ request, response: result }).byteLength
			if (bytes > this.#bytes)
				throw new StudyError('CAPACITY', 'Scripted request exceeds its encoded workload bound')
			try {
				ticket = await plan.context.meter.admit({
					role: 'agent',
					tokens: response.tokens ?? 1,
					bytes: response.bytes ?? this.#bytes,
				})
			} catch (error) {
				await plan.context.evidence.append({
					event: 'admission',
					goal: plan.goal,
					value: { role: 'agent', refused: true },
				})
				throw error
			}
			const bounded = AbortSignal.any([
				signal,
				plan.context.signal,
				plan.context.meter.signal,
				ticket.signal,
			])
			bounded.throwIfAborted()
			await plan.context.evidence.append({
				event: 'provider',
				goal: plan.goal,
				value: {
					request,
					response: {
						content,
						calls: response.calls.map((call) => ({
							id: call.id,
							name: call.name,
							arguments: cloneJSONValue(call.arguments),
						})),
					},
				},
			})
			if (content.length > 0) yield { channel: 'content', text: content }
			bounded.throwIfAborted()
			ticket.finish({
				role: 'agent',
				calls: 1,
				tokens: undefined,
				bytes,
				duration: Math.ceil(performance.now() - started),
			})
			if (response.cancel === true) {
				await plan.context.evidence.append({
					event: 'workload',
					goal: plan.goal,
					value: { cancelled: true },
				})
				plan.workload.abort(new Error('Declared workload cancellation'))
			}
			return result
		} catch (error) {
			// Clear the ticket before settling so the finally below never settles it a second time.
			const failed = ticket
			ticket = undefined
			if (failed !== undefined) failStudyTicket(failed, error, 'agent')
			throw error
		} finally {
			try {
				// A consumer that abandons the stream leaves an admitted request unsettled; it never counts as success.
				if (ticket !== undefined && !ticket.settled)
					failStudyTicket(
						ticket,
						signal.reason ??
							new StudyError('FAULT', 'Scripted response was abandoned before completion'),
						'agent',
					)
			} finally {
				this.#running = false
			}
		}
	}
}
