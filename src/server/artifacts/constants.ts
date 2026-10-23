/** Bounds admitted files before another capture is allocated. */
export const ARTIFACT_FILES = 8192

/** Bounds all captured input bytes to 128 MiB. */
export const ARTIFACT_BYTES = 128 * 1024 * 1024

/** Bounds one captured input file to 16 MiB. */
export const ARTIFACT_FILE_BYTES = 16 * 1024 * 1024

/** Bounds all visited directory entries, including ignored assets. */
export const ARTIFACT_VISITS = 32768

/** Bounds directory nesting below each selected root. */
export const ARTIFACT_DEPTH = 64

/** Bounds selected package roots before traversal begins. */
export const ARTIFACT_ROOTS = 128
import type { ArtifactErrorCode } from './types.js'

/** Marks artifact errors across module formats and installations. */
export const ARTIFACT_ERROR_BRAND = Symbol.for('@orkestrel/study.ArtifactError')

/** Lists the artifact refusal codes. */
export const ARTIFACT_ERROR_CODES: readonly ArtifactErrorCode[] = Object.freeze([
	'ARTIFACT',
	'TRAVERSAL',
	'REDIRECT',
	'ALIAS',
	'NAME',
	'DUPLICATE',
	'OCCUPIED',
	'OVERLAP',
	'STALE',
	'VOLUME',
	'DRIFT',
	'LIMIT',
])
