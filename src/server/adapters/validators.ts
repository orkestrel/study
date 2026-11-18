import type { StudyAdapterInterface } from './types.js'
import { holds, isFunction, isObject } from '@orkestrel/contract'

/** Checks whether a factory returned the complete consumer adapter contract.
 * @param value - The unknown factory result.
 * @returns True if validation, construction, and grading are callable and a present progress
 *   projection is callable; false otherwise.
 * @example Refuse an incomplete adapter
 * ```ts
 * import { isStudyAdapter } from '@orkestrel/study/server'
 *
 * isStudyAdapter({}) // false
 * ```
 */
export function isStudyAdapter(value: unknown): value is StudyAdapterInterface {
	return holds(() => {
		return (
			isObject(value) &&
			'validate' in value &&
			isFunction(value.validate) &&
			'driver' in value &&
			isFunction(value.driver) &&
			'grade' in value &&
			isFunction(value.grade) &&
			(!('progress' in value) || value.progress === undefined || isFunction(value.progress))
		)
	})
}
