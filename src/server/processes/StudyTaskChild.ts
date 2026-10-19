import type { ChildProcess } from 'node:child_process'
import type { StudyTaskOptions, StudyTaskResult } from './types.js'
import { isJSONValue, isRecord } from '@orkestrel/contract'
import { fork } from 'node:child_process'
import { StudyError } from '../../core/errors.js'
import { isStudyDigest } from '../../core/validators.js'
import { STUDY_FRAME_BYTES, STUDY_LOG_BYTES, STUDY_TASK_OPERATION } from './constants.js'
import { drainStudyChild, terminateStudyChild } from './helpers.js'

/** Supervises one forked adapter child until it closes with one verified response. */
export class StudyTaskChild {
	readonly #options: StudyTaskOptions
	readonly #duration: number
	readonly #signal: AbortSignal
	#failure: unknown
	#result: StudyTaskResult | undefined
	#logs = 0
	#executed = false

	/** Binds one adapter evaluation to its owned route, validated deadline and caller cancellation.
	 * @param options - The owning task's snapshotted entry, root and selection.
	 * @param duration - The validated deadline in milliseconds.
	 * @param signal - Caller cancellation.
	 */
	constructor(options: StudyTaskOptions, duration: number, signal: AbortSignal) {
		this.#options = options
		this.#duration = duration
		this.#signal = signal
	}

	/** Forks the adapter child, sends one request frame and settles with its single verified response.
	 * @param input - The validated request frame.
	 * @returns The verified adapter output and instrumentation identity.
	 * @throws StudyError - Thrown with code `CONFIG` when this child is already supervised.
	 */
	execute(input: Readonly<Record<string, unknown>>): Promise<StudyTaskResult> {
		if (this.#executed) throw new StudyError('CONFIG', 'Study task child can execute only once')
		this.#executed = true
		const signal = this.#signal
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
			const listeners = new AbortController()
			const timer = setTimeout(() => {
				this.#failure = new StudyError('FAULT', 'Adapter deadline exceeded', {
					cause: 'deadline',
					message: 'Adapter deadline exceeded',
					role: undefined,
					stop: {
						layer: 'scope',
						id: 'Adapter duration',
						max: this.#duration,
						consumed: undefined,
					},
				})
				this.#terminate(child)
			}, this.#duration)
			signal.addEventListener(
				'abort',
				() => {
					this.#failure = signal.reason
					this.#terminate(child)
				},
				{ once: true, signal: listeners.signal },
			)
			child.on('message', (value: unknown) => {
				try {
					if (
						this.#result !== undefined ||
						!isRecord(value) ||
						Buffer.byteLength(JSON.stringify(value)) > STUDY_FRAME_BYTES
					)
						throw new StudyError('FAULT', 'Adapter response is oversized or repeated')
					if (typeof value.error === 'string')
						throw new StudyError(value.code === 'CONFIG' ? 'CONFIG' : 'FAULT', value.error)
					if (!isStudyDigest(value.instrument) || !isJSONValue(value.value))
						throw new StudyError('FAULT', 'Adapter response is malformed')
					this.#result = { instrument: value.instrument, value: value.value }
				} catch (error) {
					this.#failure = error
				}
				this.#terminate(child)
			})
			for (const stream of [child.stdout, child.stderr])
				stream?.on('data', (chunk: Buffer) => {
					this.#logs += chunk.byteLength
					if (this.#logs <= STUDY_LOG_BYTES) return
					this.#failure = new StudyError('FAULT', 'Adapter output exceeds the log allowance')
					this.#terminate(child)
				})
			child.once('error', (error) => {
				this.#failure = error
			})
			child.once('close', () => {
				clearTimeout(timer)
				listeners.abort()
				const result = this.#result
				if (this.#failure !== undefined) reject(this.#failure)
				else if (result === undefined)
					reject(new StudyError('FAULT', 'Adapter exited without a complete response'))
				else resolve(result)
			})
			child.send(input, (error: Error | null) => {
				if (error === null) return
				this.#failure = error
				this.#terminate(child)
			})
			if (signal.aborted) {
				this.#failure = signal.reason
				this.#terminate(child)
			}
		})
	}

	// Terminates the child tree; a termination failure replaces the failure that requested it.
	#terminate(child: ChildProcess): void {
		try {
			terminateStudyChild(child)
		} catch (error) {
			this.#failure = error
		}
	}
}
