import type { Message, ProviderDelta, ProviderInterface, ProviderResult } from '@orkestrel/agent'
import type { StudyTicket } from '../../core/types.js'
import type { StudyAgentPlan, StudyAgentResponse, StudyAgentScriptOptions } from './types.js'
import { cloneJSONValue, isArray } from '@orkestrel/contract'
import { randomUUID } from 'node:crypto'
import { StudyError } from '../../core/errors.js'
import { failStudyTicket } from '../../core/engines/helpers.js'
import { encodeStudyJSON } from '../helpers.js'
import {
	resolveStudyAgentContent,
	readStudyAgentMessages,
	readStudyAgentResult,
} from './helpers.js'
import { isStudyAgentResponse } from './validators.js'
import { StudyAgentScriptGoal } from './StudyAgentScriptGoal.js'

/** Serves declared inert responses through the actual Agent provider boundary. */
export class StudyAgentScript implements ProviderInterface {
	readonly id = randomUUID()
	readonly name = 'scripted-study'
	readonly #bytes: number
	// The prepared goal; `prepare` binds it and `clear` releases it. A running stream keeps the goal it took its response from.
	#goal: StudyAgentScriptGoal | undefined
	// The responses being served; a response joins when its stream starts and leaves when the stream settles.
	readonly #serving = new Set<StudyAgentResponse>()

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
	 * Prepares one goal's declared response sequence and metered operational boundary until `clear` ends the goal.
	 * @param plan - The workload's responses and its operational context
	 * @returns Nothing when the provider is ready
	 * @throws StudyError - Thrown with code `CONFIG` when a response is still running, a goal is already prepared, or a declared response is invalid; a prepared goal stays prepared
	 */
	prepare(plan: StudyAgentPlan): void {
		if (this.#serving.size !== 0)
			throw new StudyError('CONFIG', 'Cannot replace a running scripted workload')
		if (this.#goal !== undefined)
			throw new StudyError('CONFIG', 'Scripted goal is already prepared')
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
		this.#goal = new StudyAgentScriptGoal({ ...plan, responses: Object.freeze(owned) })
	}

	/**
	 * Ends the prepared goal so another goal can be prepared; a stream already running keeps serving its own goal.
	 * @returns Nothing; a provider with no prepared goal stays unprepared
	 */
	clear(): void {
		this.#goal = undefined
	}

	/**
	 * Consumes the same streaming response into its assembled provider result.
	 * @param messages - The actual Agent conversation
	 * @param signal - The enclosing Agent run signal
	 * @returns The assembled declared response
	 */
	async generate(messages: readonly Message[], signal: AbortSignal): Promise<ProviderResult> {
		return readStudyAgentResult(this.stream(messages, signal))
	}

	/**
	 * Streams a declared response after authoritative admission and retains actual request bytes.
	 * @param messages - The actual Agent conversation
	 * @param signal - The enclosing Agent run signal
	 * @returns The declared response, optionally consuming an actual prior tool message
	 * @remarks
	 * A stream abandoned after admission, for example by `return`, fails its admitted request with the
	 * run signal's reason, or a `FAULT` when the signal carries none, and never finishes it as success.
	 * @throws StudyError - Thrown with code `CONFIG` when no goal is prepared, another response is running, or the responses are exhausted; thrown with the meter's refusal when admission fails
	 */
	async *stream(
		messages: readonly Message[],
		signal: AbortSignal,
	): AsyncGenerator<ProviderDelta, ProviderResult> {
		const goal = this.#goal
		if (goal === undefined || this.#serving.size !== 0)
			throw new StudyError('CONFIG', 'Scripted provider is unavailable')
		const response = goal.take()
		if (response === undefined)
			throw new StudyError('CONFIG', 'Scripted provider response sequence is exhausted')
		const plan = goal.plan
		this.#serving.add(response)
		const started = performance.now()
		try {
			const request = readStudyAgentMessages(messages)
			const content = resolveStudyAgentContent(request, response)
			const result: ProviderResult = {
				content,
				...(response.calls.length === 0 ? {} : { tools: response.calls }),
			}
			const bytes = encodeStudyJSON({ request, response: result }).byteLength
			if (bytes > this.#bytes)
				throw new StudyError('CAPACITY', 'Scripted request exceeds its encoded workload bound')
			const ticket = await this.#admit(plan, response)
			try {
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
				if (response.abort === true) {
					await plan.context.evidence.append({
						event: 'workload',
						goal: plan.goal,
						value: { aborted: true },
					})
					plan.workload.abort(new Error('Declared workload cancellation'))
				}
				return result
			} catch (error) {
				failStudyTicket(ticket, error, 'agent')
				throw error
			} finally {
				// A consumer that abandons the stream leaves an admitted request unsettled; it never counts as success.
				// A settled ticket is left untouched, so the failure above is never recorded twice.
				failStudyTicket(
					ticket,
					signal.reason ??
						new StudyError('FAULT', 'Scripted response was abandoned before completion'),
					'agent',
				)
			}
		} finally {
			this.#serving.delete(response)
		}
	}

	// Admits the response's ceiling, retaining a refused admission as evidence before rethrowing it.
	async #admit(plan: StudyAgentPlan, response: StudyAgentResponse): Promise<StudyTicket> {
		try {
			return await plan.context.meter.admit({
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
	}
}
