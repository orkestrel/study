import type { StudyAgentDispatch } from '@src/core'
import type {
	StudyOllamaModel,
	StudyOllamaPolicy,
	StudyOllamaRole,
	StudyOllamaSnapshot,
	StudyOllamaTransportOptions,
} from './types.js'
import { StudyError } from '@src/core'

/**
 * Builds a frozen owned copy of transport configuration that later caller mutation cannot reach.
 * @remarks
 * Every caller member is read once, outer fields before nested data. Every nested data object is
 * copied and frozen; the caller's objects are never frozen. The cancellation signal, timing
 * extractor, and fetch collaborator keep their live identity.
 * @param options - The caller's transport configuration
 * @returns The owned configuration, not yet validated
 */
export function buildStudyOllamaTransportOptions(
	options: StudyOllamaTransportOptions,
): StudyOllamaTransportOptions {
	const {
		url,
		room,
		limit,
		models,
		roles,
		signal,
		observe,
		timing,
		fetch,
		metadata,
		version,
		procedure,
		exchanges,
	} = options
	if (Object.hasOwn(roles, 'maintenance'))
		throw new StudyError('CONFIG', 'Maintenance cannot declare a generation policy')
	const owned: Record<string, StudyOllamaModel> = Object.fromEntries(
		Object.entries(models).map(([label, { name, digest }]) => [
			label,
			Object.freeze({ name, digest }),
		]),
	)
	const policies: Partial<Record<StudyOllamaRole, StudyOllamaPolicy>> = Object.fromEntries(
		(['agent', 'summary', 'judge'] as const).flatMap((role) => {
			const policy = roles[role]
			if (policy === undefined) return []
			const { model, options: wire, think, strict, length } = policy
			return [
				[
					role,
					Object.freeze({ model, options: Object.freeze({ ...wire }), think, strict, length }),
				] as const,
			]
		}),
	)
	const { context, safety } = room
	const { duration, bytes } = limit
	return Object.freeze({
		url,
		room: Object.freeze({ context, safety }),
		limit: Object.freeze({ duration, bytes }),
		models: Object.freeze(owned),
		roles: Object.freeze(policies),
		signal,
		observe,
		timing,
		metadata: Object.freeze({ ...metadata }),
		...(version === undefined ? {} : { version }),
		...(procedure === undefined
			? {}
			: {
					procedure: Object.freeze(
						procedure.map((step) => {
							const { policy, ...identity } = step
							if (
								(identity.admission === 'exact' && Object.hasOwn(step, 'bytes')) ||
								(identity.admission === 'capture' &&
									(Object.hasOwn(step, 'body') || Object.hasOwn(step, 'input')))
							)
								throw new StudyError('CONFIG', 'Conflicting model-step admission declarations')
							const { options: wire, ...settings } = policy
							return Object.freeze({
								...identity,
								policy: Object.freeze({ ...settings, options: Object.freeze({ ...wire }) }),
							})
						}),
					),
				}),
		...(exchanges === undefined ? {} : { exchanges }),
		...(fetch === undefined ? {} : { fetch }),
	})
}

/**
 * Builds an owned snapshot of one outbound request before anything is awaited.
 * @remarks
 * The URL spelling, accepted settings, headers, and dispatch are copied at the call, each caller
 * member read once; headers are cloned from the copied settings. The settings' `signal` keeps its
 * live identity so caller cancellation still reaches the request.
 * @param input - The requested URL
 * @param init - The native fetch settings
 * @param dispatch - The canonical dispatch the caller measured
 * @returns The owned request facts
 * @throws StudyError - Thrown with code `CONFIG` when the input is a `Request`
 */
export function buildStudyOllamaSnapshot(
	input: string | URL | Request,
	init: RequestInit | undefined,
	dispatch: StudyAgentDispatch | undefined,
): StudyOllamaSnapshot {
	if (input instanceof Request)
		throw new StudyError('CONFIG', 'Ollama transport requires explicit URL requests')
	const copy = init === undefined ? undefined : { ...init }
	return {
		url: typeof input === 'string' ? input : input.href,
		init:
			copy === undefined || copy.headers === undefined
				? copy
				: { ...copy, headers: new Headers(copy.headers) },
		dispatch: dispatch === undefined ? undefined : { id: dispatch.id, revision: dispatch.revision },
	}
}
