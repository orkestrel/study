import type { ProviderRequest } from '@orkestrel/agent'
import type { JSONValue } from '@orkestrel/contract'
import { attempt, canonicalStringify, isArray, isObject } from '@orkestrel/contract'
import { StudyError } from '../../core/errors.js'
import { hashStudyBytes } from '../helpers.js'

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
	const readings: JSONValue[] = []
	for (const entry of result.readings) {
		if (
			!isObject(entry) ||
			!('key' in entry) ||
			typeof entry.key !== 'string' ||
			!('phase' in entry) ||
			typeof entry.phase !== 'string' ||
			!('outcome' in entry) ||
			typeof entry.outcome !== 'string'
		)
			continue
		readings.push({
			key: entry.key,
			phase: entry.phase,
			outcome: entry.outcome,
			duration: 'duration' in entry && typeof entry.duration === 'number' ? entry.duration : null,
		})
	}
	return readings
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
