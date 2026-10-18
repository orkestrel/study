import type { ChildProcess } from 'node:child_process'
import type { StudyLaunchResult } from './types.js'
import { StudyError } from '../../core/errors.js'
import { terminateStudyChild } from '../processes/helpers.js'
import { STUDY_LAUNCH_BYTES } from './constants.js'

/** Supervises one launched command child until it closes under its output allowance and deadline. */
export class StudyLaunchChild {
	readonly #child: ChildProcess
	readonly #duration: number
	readonly #forward: boolean
	readonly #signal: AbortSignal
	readonly #chunks: Buffer[] = []
	#bytes = 0
	#failure: Error | undefined
	#expired = false
	#executed = false

	/** Binds one spawned child to its deadline, output route and the launcher's interruption.
	 * @param child - The spawned child; `execute` subscribes before any of its events can fire.
	 * @param duration - The deadline in milliseconds.
	 * @param forward - If `true`, stdout is forwarded to this process; if `false`, it is captured as the result output.
	 * @param signal - The launcher's interruption; an abort terminates the child and reports 130.
	 */
	constructor(child: ChildProcess, duration: number, forward: boolean, signal: AbortSignal) {
		this.#child = child
		this.#duration = duration
		this.#forward = forward
		this.#signal = signal
	}

	/** Waits for the child to close and reports its exit code and captured output.
	 * @returns The child's code, 130 after interruption or 124 after the deadline, with captured stdout.
	 * @throws StudyError - Thrown with code `CONFIG` when this child is already supervised.
	 */
	execute(): Promise<StudyLaunchResult> {
		if (this.#executed) throw new StudyError('CONFIG', 'Study launch can execute only once')
		this.#executed = true
		const child = this.#child
		const signal = this.#signal
		return new Promise((resolve, reject) => {
			const listeners = new AbortController()
			const timer = setTimeout(() => {
				this.#expired = true
				terminateStudyChild(child)
			}, this.#duration)
			signal.addEventListener('abort', () => terminateStudyChild(child), {
				once: true,
				signal: listeners.signal,
			})
			child.stdout?.on('data', (chunk: Buffer) => {
				if (!this.#measure(chunk)) return
				if (this.#forward) process.stdout.write(chunk)
				else this.#chunks.push(chunk)
			})
			child.stderr?.on('data', (chunk: Buffer) => {
				if (this.#measure(chunk)) process.stderr.write(chunk)
			})
			child.once('error', (error) => {
				this.#failure ??= error
			})
			child.once('close', (code) => {
				clearTimeout(timer)
				listeners.abort()
				if (this.#failure !== undefined) {
					reject(this.#failure)
					return
				}
				if (this.#expired)
					process.stderr.write(
						`study: DEADLINE: Process tree exceeded its ${this.#duration} ms deadline\n`,
					)
				resolve({
					code: signal.aborted ? 130 : this.#expired ? 124 : (code ?? 1),
					output: Buffer.concat(this.#chunks).toString('utf8'),
				})
			})
			if (signal.aborted) terminateStudyChild(child)
		})
	}

	// Counts a chunk against the shared stdout and stderr allowance; an overflow retains the failure and terminates the tree.
	#measure(chunk: Buffer): boolean {
		this.#bytes += chunk.byteLength
		if (this.#bytes <= STUDY_LAUNCH_BYTES) return true
		this.#failure ??= new Error('Study command output exceeds the 16 MiB host allowance')
		terminateStudyChild(this.#child)
		return false
	}
}
