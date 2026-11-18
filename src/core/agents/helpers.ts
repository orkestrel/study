import type { JSONValue } from '@orkestrel/contract'
import type { LedgerGauge, ProviderResult, RequestMeasure } from '@orkestrel/agent'
import type { StudyRole, StudyStop } from '../types.js'
import type { StudyAgentDispatch } from './types.js'
import { attempt, isNonEmptyString, isNumber, isObject } from '@orkestrel/contract'
import { StudyError } from '../errors.js'
import { parseStudyMeasurement } from '../parsers.js'

/**
 * Prices a runtime estimate through an explicit gauge.
 * @param gauge - The declared scale and overhead
 * @param estimate - The runtime's estimate of one complete request
 * @returns The projected prompt tokens, rounded up
 * @example
 * ```ts
 * projectStudyAgentRequest({ scale: 1.5, overhead: 10 }, 100) // 160
 * ```
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
 * @example
 * ```ts
 * validateStudyAgentUsage({ prompt: 120, completion: 8 }, 'agent') // returns
 * validateStudyAgentUsage({ prompt: 0, completion: 8 }, 'agent') // throws a FAULT StudyError
 * ```
 */
export function validateStudyAgentUsage(usage: ProviderResult['usage'], role: StudyRole): void {
	const prompt = usage?.prompt
	if (!isNumber(prompt) || !Number.isFinite(prompt) || prompt <= 0) {
		const message = 'Gauged request returned no usable prompt count'
		throw new StudyError('FAULT', message, {
			cause: 'infrastructure',
			message,
			role,
			stop: undefined,
		})
	}
}

/**
 * Translates an Agent run's stop record into the attributable capacity failure of the layer that stopped it.
 * @remarks
 * The record is foreign data from the admitted runtime, so the helper reads it once, each member
 * once, inside one contained boundary, and validates only the members it dereferences. A `meter`
 * or `budget` stop always leaves the run partial; a `model` stop is a complete answer, so a
 * consumer whose role admits a `length` finish keeps it. The consumer throws the returned error
 * when its policy refuses the stop. A `model` stop reports no cap because the Agent does not see
 * one; its `consumed` is the completion the stopped call reported, when finite.
 * @param stop - The `stop` member of an Agent or Ledger result
 * @returns Undefined when `stop` is undefined; a `CAPACITY` StudyError with role `agent` and the Agent layer for a meter, budget, or model stop; a `FAULT` StudyError with role `agent` for a malformed record
 * @example
 * ```ts
 * translateStudyAgentStop({ layer: 'meter', id: 'meter', max: 2000, consumed: 2001 })
 * // a CAPACITY StudyError whose context.stop is { layer: 'meter', id: 'meter', max: 2000, consumed: 2001 }
 * ```
 */
export function translateStudyAgentStop(stop: unknown): StudyError | undefined {
	if (stop === undefined) return undefined
	const outcome = attempt((): StudyStop | undefined => {
		if (!isObject(stop)) return undefined
		const layer: unknown = Reflect.get(stop, 'layer')
		const id: unknown = Reflect.get(stop, 'id')
		if (!isNonEmptyString(id)) return undefined
		if (layer === 'meter' || layer === 'budget') {
			const max: unknown = Reflect.get(stop, 'max')
			const consumed: unknown = Reflect.get(stop, 'consumed')
			const limit = parseStudyMeasurement(max)
			const used = parseStudyMeasurement(consumed)
			return limit === undefined || used === undefined
				? undefined
				: { layer, id, max: limit, consumed: used }
		}
		if (layer === 'model') {
			const usage: unknown = Reflect.get(stop, 'usage')
			return {
				layer,
				id,
				max: undefined,
				consumed: isObject(usage)
					? parseStudyMeasurement(Reflect.get(usage, 'completion'))
					: undefined,
			}
		}
		return undefined
	})
	const parsed = outcome.success ? outcome.value : undefined
	if (parsed === undefined) {
		const message = 'Agent stop record is malformed'
		return new StudyError('FAULT', message, {
			cause: 'infrastructure',
			message,
			role: 'agent',
			stop: undefined,
		})
	}
	const message =
		parsed.layer === 'meter'
			? 'Agent meter allowance reached its ceiling'
			: parsed.layer === 'budget'
				? 'Agent budget reached its ceiling'
				: 'Agent model reached its own token limit'
	return new StudyError('CAPACITY', message, {
		cause: 'capacity',
		message,
		role: 'agent',
		stop: parsed,
	})
}

/**
 * Projects a request's structural components onto plain JSON without storing a total.
 * @param measure - The runtime's disjoint per-message, tools and schema estimates
 * @returns The same components in request order
 * @example
 * ```ts
 * declare const measure: RequestMeasure
 * buildStudyAgentParts(measure) // { messages, tools, schema }
 * ```
 */
export function buildStudyAgentParts(measure: RequestMeasure): JSONValue {
	return {
		messages: measure.messages.map((message) => ({
			id: message.id,
			role: message.role,
			content: message.content,
			uniform: message.uniform,
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
 * @example
 * ```ts
 * buildStudyAgentDispatch(undefined) // { canonical: null, revision: null }
 * ```
 */
export function buildStudyAgentDispatch(
	dispatch: StudyAgentDispatch | undefined,
): Readonly<Record<string, JSONValue>> {
	return { canonical: dispatch?.id ?? null, revision: dispatch?.revision ?? null }
}
