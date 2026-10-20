import type { StudyTaskOptions, StudyTaskRequest, StudyTaskResult } from './types.js'
import { StudyError } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { STUDY_FRAME_BYTES, STUDY_TASK_DURATION } from './constants.js'
import { valueToWire } from './helpers.js'
import { StudyTaskChild } from './StudyTaskChild.js'

/** Bounds adapter evaluation by an independent native parent timer. */
export class StudyTask {
	#options: StudyTaskOptions
	/** Owns the built child route and captured source selection.
	 * @param options - Consumer root, runtime entry, adapter, and admitted dependencies.
	 */
	constructor(options: StudyTaskOptions) {
		this.#options = structuredClone(options)
	}
	/** Executes one validation or grading operation in a fresh child.
	 * @param request - Declarations or retained evidence, never a trial payload.
	 * @param signal - Caller cancellation.
	 * @returns Verified adapter output and active instrumentation identity.
	 */
	execute(request: StudyTaskRequest, signal: AbortSignal): Promise<StudyTaskResult> {
		signal.throwIfAborted()
		const duration = this.#options.duration ?? STUDY_TASK_DURATION
		if (!Number.isSafeInteger(duration) || duration <= 0 || duration > STUDY_TASK_DURATION)
			throw new StudyError('CONFIG', 'Adapter deadline must be finite and at most 60 seconds')
		const input = valueToWire({ ...this.#options, ...request })
		if (!isRecord(input)) throw new StudyError('CONFIG', 'Adapter input must be an object')
		if (Buffer.byteLength(JSON.stringify(input)) > STUDY_FRAME_BYTES)
			throw new StudyError('CONFIG', 'Adapter input exceeds the frame allowance')
		// Each call supervises its own child, so concurrent calls never share event state.
		return new StudyTaskChild(this.#options, duration, signal).execute(input)
	}
}
