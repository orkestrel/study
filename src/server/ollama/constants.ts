import type { StudyOllamaKeyedRole } from './types.js'

/** Lists the roles a keyed replay can serve; `maintenance` and `tool` send no recorded request. */
export const STUDY_OLLAMA_KEYED_ROLES: readonly StudyOllamaKeyedRole[] = Object.freeze([
	'agent',
	'judge',
	'summary',
	'metadata',
])
