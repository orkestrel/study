import { canonicalStringify, parseJSON } from '@orkestrel/contract'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import { StudyError } from '../core/errors.js'

/** Checks strict lexical containment under a selected directory.
 * @param root - The canonical directory.
 * @param path - The candidate absolute file.
 * @returns True if the file is below the directory; false otherwise.
 */
export function containsArtifact(root: string, path: string): boolean {
	const location = relative(root, path)
	return (
		location !== '' &&
		location !== '..' &&
		!location.startsWith(`..${sep}`) &&
		!isAbsolute(location)
	)
}

/**
 * Computes the lowercase SHA-256 identity of exact bytes or UTF-8 text.
 * @param input - The retained bytes, or text identified by its UTF-8 bytes
 * @returns The lowercase hexadecimal digest
 * @example Identify captured bytes
 * ```ts
 * import { hashStudyBytes } from '@orkestrel/study/server'
 *
 * hashStudyBytes('retained evidence')
 * ```
 */
export function hashStudyBytes(input: string | Uint8Array): string {
	return createHash('sha256').update(input).digest('hex')
}

/**
 * Encodes deterministic JSON bytes without synthesizing execution metadata.
 * @param value - The validated record
 * @returns The exact canonical UTF-8 bytes
 * @throws StudyError - Thrown when the record cannot be serialized
 * @example Encode custody bytes
 * ```ts
 * import { encodeStudyJSON } from '@orkestrel/study/server'
 *
 * encodeStudyJSON({ id: 1 })
 * ```
 */
export function encodeStudyJSON(value: unknown): Uint8Array {
	const wire = JSON.stringify(value)
	const text = wire === undefined ? undefined : canonicalStringify(parseJSON(wire))
	if (text === undefined) throw new StudyError('EVIDENCE', 'Record cannot be encoded')
	return Buffer.from(`${text}\n`, 'utf8')
}

/**
 * Decodes strict UTF-8 custody bytes and parses their JSON text.
 * @param bytes - The exact retained bytes
 * @returns The parsed value, or undefined when the text is not JSON
 * @throws TypeError - Thrown when the bytes are not valid UTF-8
 * @example
 * ```ts
 * decodeStudyJSON(new TextEncoder().encode('{"id":1}')) // { id: 1 }
 * ```
 */
export function decodeStudyJSON(bytes: Uint8Array): unknown {
	return parseJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
