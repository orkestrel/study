import type { StudyOllamaKeyedRole } from './types.js'

/**
 * Keys the mark a keyed replay stamps on a response it served from a recording.
 * @remarks
 * The mark is an own property a local caller sets, so no daemon reply can claim it.
 */
export const STUDY_OLLAMA_SERVED = Symbol.for('@orkestrel/study.served')

/** Lists the roles a keyed replay can serve; `maintenance` and `tool` send no recorded request. */
export const STUDY_OLLAMA_KEYED_ROLES: readonly StudyOllamaKeyedRole[] = Object.freeze([
	'agent',
	'judge',
	'summary',
	'metadata',
])
