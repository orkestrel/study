import type { StudyAdapterInterface } from './types.js'

/** Checks whether a factory returned the complete consumer adapter contract.
 * @param value - The unknown factory result.
 * @returns Whether validation, construction, and grading are callable.
 * @example Refuse an incomplete adapter
 * ```ts
 * import { isStudyAdapter } from '@orkestrel/study/server'
 *
 * isStudyAdapter({}) // false
 * ```
 */
export function isStudyAdapter(value: unknown): value is StudyAdapterInterface {
	try {
		return (
			typeof value === 'object' &&
			value !== null &&
			'validate' in value &&
			typeof value.validate === 'function' &&
			'driver' in value &&
			typeof value.driver === 'function' &&
			'grade' in value &&
			typeof value.grade === 'function'
		)
	} catch {
		return false
	}
}
