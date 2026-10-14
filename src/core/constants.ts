import type { StudyCause, StudyRole } from './types.js'

/** Caps a declared trial population before schedule allocation. */
export const STUDY_TRIALS = 4096

/** Caps a declared scenario horizon before execution. */
export const STUDY_GOALS = 4096

/** Restricts identifiers to portable path-safe names. */
export const STUDY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Lists every measured request role in report order. */
export const STUDY_ROLES: readonly StudyRole[] = Object.freeze([
	'agent',
	'judge',
	'summary',
	'metadata',
	'tool',
])

/** Lists every operational ending in report order. */
export const STUDY_CAUSES: readonly StudyCause[] = Object.freeze([
	'capacity',
	'infrastructure',
	'deadline',
	'interrupted',
])
