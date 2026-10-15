import type { StudyCause, StudyRole } from './types.js'

/**
 * Keys the own self-identity every study error stamps on itself.
 * @remarks
 * The global symbol registry lets every package, ESM, CommonJS and captured copy read the same
 * key. The registry makes the key discoverable; it is a recognition mechanism, not an
 * unforgeable provenance marker.
 */
export const STUDY_ERROR_BRAND = Symbol.for('@orkestrel/study.error')

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
	'content',
])
