import type { StudyTaskOptions, StudyTaskRequest, StudyTaskResult } from './types.js'
import { isJSONValue, isRecord } from '@orkestrel/contract'
import { fork } from 'node:child_process'
import { StudyError } from '../../core/errors.js'
import { isStudyDigest } from '../../core/validators.js'
import {
	STUDY_FRAME_BYTES,
	STUDY_LOG_BYTES,
	STUDY_TASK_DURATION,
	STUDY_TASK_OPERATION,
} from './constants.js'
import { drainStudyChild, terminateStudyChild, toStudyWire } from './helpers.js'

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
		const input = toStudyWire({ ...this.#options, ...request })
		if (!isRecord(input)) throw new StudyError('CONFIG', 'Adapter input must be an object')
		if (Buffer.byteLength(JSON.stringify(input)) > STUDY_FRAME_BYTES)
			throw new StudyError('CONFIG', 'Adapter input exceeds the frame allowance')
		return new Promise((resolve, reject) => {
			const child = fork(this.#options.entry, [STUDY_TASK_OPERATION], {
				cwd: this.#options.root,
				execArgv: [...process.execArgv],
				silent: true,
				windowsHide: true,
				detached: process.platform !== 'win32',
				serialization: 'json',
			})
			drainStudyChild(child)
			let failure: unknown
			let result: StudyTaskResult | undefined
			let logs = 0
			const listeners = new AbortController()
			const timer = setTimeout(() => {
				failure = new StudyError('FAULT', 'Adapter deadline exceeded', {
					cause: 'deadline',
					message: 'Adapter deadline exceeded',
					role: undefined,
				})
				try {
					terminateStudyChild(child)
				} catch (error) {
					failure = error
				}
			}, duration)
			signal.addEventListener(
				'abort',
				() => {
					failure = signal.reason
					try {
						terminateStudyChild(child)
					} catch (error) {
						failure = error
					}
				},
				{ once: true, signal: listeners.signal },
			)
			child.on('message', (value: unknown) => {
				try {
					if (
						result !== undefined ||
						!isRecord(value) ||
						Buffer.byteLength(JSON.stringify(value)) > STUDY_FRAME_BYTES
					)
						throw new StudyError('FAULT', 'Adapter response is oversized or repeated')
					if (typeof value.error === 'string')
						throw new StudyError(value.code === 'CONFIG' ? 'CONFIG' : 'FAULT', value.error)
					if (!isStudyDigest(value.instrument) || !isJSONValue(value.value))
						throw new StudyError('FAULT', 'Adapter response is malformed')
					result = { instrument: value.instrument, value: value.value }
				} catch (error) {
					failure = error
				}
				try {
					terminateStudyChild(child)
				} catch (error) {
					failure = error
				}
			})
			for (const stream of [child.stdout, child.stderr])
				stream?.on('data', (chunk: Buffer) => {
					logs += chunk.byteLength
					if (logs > STUDY_LOG_BYTES) {
						failure = new StudyError('FAULT', 'Adapter output exceeds the log allowance')
						try {
							terminateStudyChild(child)
						} catch (error) {
							failure = error
						}
					}
				})
			child.once('error', (error) => {
				failure = error
			})
			child.once('close', () => {
				clearTimeout(timer)
				listeners.abort()
				if (failure !== undefined) reject(failure)
				else if (result === undefined)
					reject(new StudyError('FAULT', 'Adapter exited without a complete response'))
				else resolve(result)
			})
			child.send(input, (error: Error | null) => {
				if (error !== null) {
					failure = error
					try {
						terminateStudyChild(child)
					} catch (cause) {
						failure = cause
					}
				}
			})
			if (signal.aborted) {
				failure = signal.reason
				try {
					terminateStudyChild(child)
				} catch (error) {
					failure = error
				}
			}
		})
	}
}
