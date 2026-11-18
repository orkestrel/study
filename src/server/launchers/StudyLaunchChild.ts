import type { ChildProcess } from 'node:child_process'
import type { StudyLaunchForward, StudyLaunchResult } from './types.js'
import { StudyError } from '@src/core'
import { drainStudyChild, terminateStudyChild } from '../processes/helpers.js'
import { STUDY_LAUNCH_BYTES } from './constants.js'

/**
 * Supervises one launched command child until it closes under its output allowance and deadline.
 * @example
 * ```ts
 * import { spawn } from 'node:child_process'
 *
 * declare const entry: string
 * const child = spawn(process.execPath, [entry, '--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
 * const forward = { stdout: false, stderr: false }
 * const result = await new StudyLaunchChild(child, 60000, forward, new AbortController().signal).execute()
 * result.code // 0 when the command succeeded
 * ```
 */
export class StudyLaunchChild {
	readonly #child: ChildProcess
	readonly #duration: number
	readonly #forward: StudyLaunchForward
	readonly #signal: AbortSignal
	readonly #stdout: Buffer[] = []
	readonly #stderr: Buffer[] = []
	readonly #terminated = new AbortController()
	#bytes = 0
	#failure: Error | undefined
	#expired = false
	#executed = false

	/** Binds one spawned child to its deadline, output route and the launcher's interruption.
	 * @param child - The spawned child; `execute` subscribes before any of its events can fire.
	 * @param duration - The deadline in milliseconds.
	 * @param forward - Each stream forwarded to this process when `true`, or captured as the result's text when `false`.
	 * @param signal - The launcher's interruption; an abort terminates the child and reports 130.
	 */
	constructor(
		child: ChildProcess,
		duration: number,
		forward: StudyLaunchForward,
		signal: AbortSignal,
	) {
		this.#child = child
		this.#duration = duration
		this.#forward = { stdout: forward.stdout, stderr: forward.stderr }
		this.#signal = signal
	}

	/** Waits for the child to close and reports its exit code and the text each captured stream carried.
	 * @returns The child's code, 130 after interruption or 124 after the deadline, with each captured stream.
	 * @throws StudyError - Thrown with code `CONFIG` when this child is already supervised.
	 */
	execute(): Promise<StudyLaunchResult> {
		if (this.#executed) throw new StudyError('CONFIG', 'Study launch can execute only once')
		this.#executed = true
		const child = this.#child
		const signal = this.#signal
		return new Promise((resolve, reject) => {
			const listeners = new AbortController()
			this.#terminated.signal.addEventListener('abort', () => drainStudyChild(child), {
				once: true,
				signal: listeners.signal,
			})
			const timer = setTimeout(() => {
				this.#expired = true
				this.#terminate()
			}, this.#duration)
			signal.addEventListener('abort', () => this.#terminate(), {
				once: true,
				signal: listeners.signal,
			})
			child.stdout?.on('data', (chunk: Buffer) => {
				if (!this.#measure(chunk)) return
				if (this.#forward.stdout) process.stdout.write(chunk)
				else this.#stdout.push(chunk)
			})
			child.stderr?.on('data', (chunk: Buffer) => {
				if (this.#measure(chunk)) this.#writeStderr(chunk)
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
					this.#writeStderr(
						Buffer.from(
							`study: DEADLINE: Process tree exceeded its ${this.#duration} ms deadline\n`,
						),
					)
				resolve({
					code: signal.aborted ? 130 : this.#expired ? 124 : (code ?? 1),
					stdout: Buffer.concat(this.#stdout).toString('utf8'),
					stderr: Buffer.concat(this.#stderr).toString('utf8'),
				})
			})
			if (signal.aborted) this.#terminate()
		})
	}

	// Counts a chunk against the shared stdout and stderr allowance; an overflow retains the failure and terminates the tree.
	#measure(chunk: Buffer): boolean {
		this.#bytes += chunk.byteLength
		if (this.#bytes <= STUDY_LAUNCH_BYTES) return true
		this.#failure ??= new Error('Study command output exceeds the 16 MiB host allowance')
		this.#terminate()
		return false
	}

	#terminate(): void {
		this.#terminated.abort()
		terminateStudyChild(this.#child)
	}

	#writeStderr(chunk: Buffer): void {
		if (this.#forward.stderr) process.stderr.write(chunk)
		else this.#stderr.push(chunk)
	}
}
