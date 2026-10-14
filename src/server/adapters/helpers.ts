import type { StudyAdapterInterface } from './types.js'
import { isRecord } from '@orkestrel/contract'
import { StudyError } from '../../core/errors.js'
import { isStudyAdapter } from './validators.js'

/** Reads a complete adapter from an admitted module namespace.
 * @param namespace - The captured consumer module.
 * @returns The validated adapter instance.
 */
export function readStudyAdapter(namespace: unknown): StudyAdapterInterface {
	if (!isRecord(namespace) || typeof namespace.createStudyAdapter !== 'function')
		throw new StudyError('CONFIG', 'Consumer module must export createStudyAdapter')
	const adapter: unknown = namespace.createStudyAdapter()
	if (!isStudyAdapter(adapter))
		throw new StudyError('CONFIG', 'Consumer factory returned an incomplete study adapter')
	return adapter
}
