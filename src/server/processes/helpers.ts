import type { StudyFailure, StudyProfile } from '../../core/types.js'
import type { JSONValue } from '@orkestrel/contract'
import { canonicalStringify, isJSONValue } from '@orkestrel/contract'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { StudyError } from '../../core/errors.js'

/** Projects optional domain fields into the JSON wire representation.
 * @param value - An owned domain value with optional undefined fields.
 * @returns A JSON-compatible snapshot.
 * @example Project a wire value
 * ```ts
 * import { toStudyWire } from '@orkestrel/study/server'
 *
 * toStudyWire({ state: 'ready', failure: undefined }) // { state: 'ready' }
 * ```
 */
export function toStudyWire(value: unknown): JSONValue {
	const parsed: unknown = JSON.parse(JSON.stringify(value))
	if (!isJSONValue(parsed)) throw new StudyError('FAULT', 'Invalid study wire value')
	return parsed
}

/** Creates attributable protocol infrastructure failure.
 * @param message - The refused operation or broken boundary.
 * @returns A domain failure that never awards task credit.
 */
export function createStudyProcessFailure(message: string): StudyFailure {
	return { cause: 'infrastructure', message, role: undefined }
}

/** Binds the canonical fully resolved execution profile carried over IPC.
 * @param profile - The resolved execution settings, with optional absent leaves.
 * @returns The SHA256 digest of the canonical JSON wire representation.
 */
export function computeStudyProfileDigest(profile: StudyProfile): string {
	const encoded = canonicalStringify(toStudyWire(profile))
	if (encoded === undefined) throw new StudyError('CONFIG', 'Study profile is not JSON-compatible')
	return createHash('sha256').update(encoded).digest('hex')
}

/** Resolves the actual host package from its trusted executable entry.
 * @param entry - The runtime's own executable, never a consumer-supplied module.
 * @returns The canonical study package root.
 */
export function resolveStudyInstrument(entry: string): string {
	let directory = dirname(realpathSync(entry))
	while (true) {
		const manifest = join(directory, 'package.json')
		if (existsSync(manifest)) {
			const value: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
			if (
				typeof value === 'object' &&
				value !== null &&
				'name' in value &&
				value.name === '@orkestrel/study'
			)
				return directory
		}
		const parent = dirname(directory)
		if (parent === directory)
			throw new StudyError('CONFIG', 'Cannot locate the study runtime package')
		directory = parent
	}
}

/** Refuses a profile that omits the actual host runtime's declared dependency bytes.
 * @param instrument - The canonical package owning the trusted runtime entry.
 * @param roots - Explicitly admitted package roots, including the instrument.
 */
export function validateStudyRuntime(instrument: string, roots: readonly string[]): void {
	const pending = [instrument]
	const visited = new Set<string>()
	while (pending.length > 0) {
		const root = pending.pop()
		if (root === undefined || visited.has(root)) continue
		visited.add(root)
		if (!roots.includes(root))
			throw new StudyError('CONFIG', `Profile roots omit a runtime dependency: ${root}`)
		const manifest = join(root, 'package.json')
		const value: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
		if (
			typeof value !== 'object' ||
			value === null ||
			!('dependencies' in value) ||
			value.dependencies === undefined
		)
			continue
		if (
			typeof value.dependencies !== 'object' ||
			value.dependencies === null ||
			Array.isArray(value.dependencies)
		)
			throw new StudyError('CONFIG', 'Runtime dependency declarations are invalid')
		const resolver = createRequire(manifest)
		for (const dependency of Object.keys(value.dependencies))
			pending.push(dirname(realpathSync(resolver.resolve(`${dependency}/package.json`))))
	}
}
