import type { ProviderDelta, ProviderRequest, ProviderResult } from '@orkestrel/agent'
import type { JSONValue } from '@orkestrel/contract'
import type { StudyAgentResponse } from './types.js'
import { StudyError } from '@src/core'
import {
	attempt,
	canonicalStringify,
	cloneJSONValue,
	isArray,
	isObject,
	isRecord,
} from '@orkestrel/contract'
import { isToolCall } from '@orkestrel/tool'
import { hashStudyBytes } from '../helpers.js'

/**
 * Builds the JSON evidence form of an Agent tool call and its executed result.
 * @param call - The call received from the admitted Agent
 * @param result - The executed tool result
 * @returns The call identity, owned arguments, success, and owned value or error text
 * @throws StudyError - Thrown with code `FAULT` when the call, result, arguments, or value is malformed
 * @example
 * ```ts
 * buildStudyAgentToolResult(call, { success: true, value: 'stored' })
 * ```
 */
export function buildStudyAgentToolResult(call: unknown, result: unknown): JSONValue {
	const observed = attempt(() =>
		isRecord(call)
			? {
					id: 'id' in call ? call.id : undefined,
					name: 'name' in call ? call.name : undefined,
					arguments: 'arguments' in call ? call.arguments : undefined,
				}
			: undefined,
	)
	if (!observed.success || !isToolCall(observed.value))
		throw new StudyError('FAULT', 'Admitted Agent supplied invalid tool observation')
	const { id, name, arguments: arguments_ } = observed.value
	const returned = attempt(() => {
		if (!isObject(result)) return undefined
		const success = 'success' in result ? result.success : undefined
		if (typeof success !== 'boolean') return undefined
		return success
			? { success, value: 'value' in result ? result.value : undefined }
			: { success, error: 'error' in result ? result.error : undefined }
	})
	if (!returned.success || returned.value === undefined)
		throw new StudyError('FAULT', 'Admitted Agent supplied invalid tool result')
	const argumentsCopy = attempt(() => cloneJSONValue(arguments_))
	if (!argumentsCopy.success)
		throw new StudyError('FAULT', 'Admitted Agent supplied non-JSON tool arguments')
	const outcome = returned.value
	if (outcome.success) {
		const valueCopy = attempt(() => cloneJSONValue(outcome.value))
		if (!valueCopy.success)
			throw new StudyError('FAULT', 'Admitted Agent supplied non-JSON tool value')
		return {
			id,
			name,
			arguments: argumentsCopy.value,
			success: true,
			value: valueCopy.value,
		}
	}
	if (typeof outcome.error !== 'string')
		throw new StudyError('FAULT', 'Admitted Agent supplied invalid tool error')
	return {
		id,
		name,
		arguments: argumentsCopy.value,
		success: false,
		error: outcome.error,
	}
}

/**
 * Builds the JSON evidence form of an Agent tool call the Agent denied before dispatch.
 * @param call - The call received from the admitted Agent
 * @param reason - The denial reason, retained only when it is a string
 * @returns The call identity with the optional string reason
 * @throws StudyError - Thrown with code `FAULT` when the call is malformed
 * @example
 * ```ts
 * buildStudyAgentToolDenial(call, 'refused')
 * ```
 */
export function buildStudyAgentToolDenial(call: unknown, reason: unknown): JSONValue {
	const observed = attempt(() =>
		isRecord(call)
			? {
					id: 'id' in call ? call.id : undefined,
					name: 'name' in call ? call.name : undefined,
					arguments: 'arguments' in call ? call.arguments : undefined,
				}
			: undefined,
	)
	if (!observed.success || !isToolCall(observed.value))
		throw new StudyError('FAULT', 'Admitted Agent supplied invalid tool observation')
	const { id, name } = observed.value
	return { id, name, ...(typeof reason === 'string' ? { reason } : {}) }
}

/**
 * Builds a request revision by hashing its canonical rendering exactly as rendered.
 * @remarks
 * The request is rendered once with key-sorted canonical JSON and hashed as rendered; no
 * newline or JSON round trip is added. Any change to content, order, ids, tools, or options
 * changes the revision.
 * @param request - The exact pre-encoding request
 * @returns The lowercase SHA-256 digest, or undefined when the request cannot be canonically rendered; a rendering failure never throws
 */
export function buildStudyAgentRevision(request: ProviderRequest): string | undefined {
	const rendered = attempt(() => canonicalStringify(request))
	if (!rendered.success || rendered.value === undefined) return undefined
	return hashStudyBytes(rendered.value)
}

/**
 * Builds the JSON evidence form of a Ledger result's logical classifier readings.
 * @param result - Value returned by the Ledger
 * @returns Null when the result carries no readings array, else one entry per well-formed reading in asking order, each with its duration or null
 */
export function buildStudyAgentReadings(result: unknown): JSONValue {
	if (!isObject(result) || !('readings' in result) || !isArray(result.readings)) return null
	return result.readings.flatMap((entry): JSONValue[] =>
		!isObject(entry) ||
		!('key' in entry) ||
		typeof entry.key !== 'string' ||
		!('phase' in entry) ||
		typeof entry.phase !== 'string' ||
		!('outcome' in entry) ||
		typeof entry.outcome !== 'string'
			? []
			: [
					{
						key: entry.key,
						phase: entry.phase,
						outcome: entry.outcome,
						duration:
							'duration' in entry && typeof entry.duration === 'number' ? entry.duration : null,
					},
				],
	)
}

/**
 * Resolves the content a scripted response serves, from its declaration or from a prior tool message.
 * @param request - The projected actual request messages
 * @param response - The declared response being served
 * @returns The declared content, or the content of the actual tool message the response consumes
 * @throws StudyError - Thrown when a consuming response has no actual referenced tool result
 */
export function resolveStudyAgentContent(
	request: readonly JSONValue[],
	response: StudyAgentResponse,
): string {
	if (response.consume === undefined) return response.content
	const prior = request.findLast(
		(message) => isRecord(message) && message.role === 'tool' && message.call === response.consume,
	)
	if (!isRecord(prior) || typeof prior.content !== 'string')
		throw new StudyError('FAULT', 'Continuation has no actual referenced tool result')
	return prior.content
}

/**
 * Drains a scripted provider stream into its assembled result.
 * @param stream - The provider stream to consume to its end
 * @returns The result the stream returns after its last delta
 */
export async function readStudyAgentResult(
	stream: AsyncGenerator<ProviderDelta, ProviderResult>,
): Promise<ProviderResult> {
	for (;;) {
		const next = await stream.next()
		if (next.done) return next.value
	}
}

/**
 * Projects foreign provider messages onto the exact fields the workload reads.
 * @param value - The foreign provider message collection
 * @returns Owned JSON message readings in original order
 * @throws StudyError - Thrown when a dereferenced foreign member is malformed
 * @example
 * ```ts
 * readStudyAgentMessages([{ id: 'm1', role: 'user', content: 'Hi' }]) // [{ role: 'user', content: 'Hi' }]
 * ```
 */
export function readStudyAgentMessages(value: unknown): readonly JSONValue[] {
	if (!isArray(value)) throw new StudyError('FAULT', 'Provider messages are not an array')
	return Object.freeze(
		Array.from(value).map((message): JSONValue => {
			if (!isObject(message)) throw new StudyError('FAULT', 'Provider message fields are invalid')
			const role = 'role' in message ? message.role : undefined
			const content = 'content' in message ? message.content : undefined
			const call = 'call' in message ? message.call : undefined
			if (
				typeof role !== 'string' ||
				typeof content !== 'string' ||
				(call !== undefined && typeof call !== 'string')
			)
				throw new StudyError('FAULT', 'Provider message fields are invalid')
			return Object.freeze({
				role,
				content,
				...(call === undefined ? {} : { call }),
			})
		}),
	)
}
