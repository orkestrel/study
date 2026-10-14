import type { StudyFailure } from '../types.js'
import type { StudyControlInterface } from './types.js'
import { Abort } from '@orkestrel/abort'
import { failureToStudyError } from './helpers.js'

/** Retains the first operational failure while bounding asynchronous waits. */
export class StudyControl implements StudyControlInterface {
	#abort: Abort
	#listeners = new Abort()
	#failure: StudyFailure | undefined

	/** Links cancellation to the caller without assigning it a task verdict.
	 * @param signal - Optional parent cancellation.
	 */
	constructor(signal?: AbortSignal) {
		this.#abort = new Abort(signal === undefined ? undefined : { signal })
		if (this.#abort.aborted) this.#interrupt()
		else
			this.#abort.signal.addEventListener('abort', () => this.#interrupt(), {
				once: true,
				signal: this.#listeners.signal,
			})
	}

	get signal(): AbortSignal {
		return this.#abort.signal
	}
	get failure(): StudyFailure | undefined {
		return this.#failure
	}

	/** Latches an operational failure and cancels all linked work.
	 * @param failure - The first attribution to preserve.
	 */
	fail(failure: StudyFailure): void {
		if (this.#failure !== undefined) return
		this.#failure = Object.freeze({ ...failure })
		this.#abort.abort(failureToStudyError(this.#failure))
	}

	/** Races work against cancellation and removes its listener after either ending.
	 * @param work - Already-started work whose rejection remains observed after cancellation.
	 * @returns The work's result if it settles before cancellation.
	 * @throws Thrown with the retained operational attribution when cancelled.
	 */
	wait<T>(work: PromiseLike<T>): Promise<T> {
		const listeners = new Abort()
		return new Promise<T>((resolve, reject) => {
			Promise.resolve(work).then(resolve, reject)
			if (this.#abort.aborted)
				reject(
					failureToStudyError(
						this.#failure ?? {
							cause: 'interrupted',
							message: 'Study interrupted',
							role: undefined,
						},
					),
				)
			else
				this.#abort.signal.addEventListener(
					'abort',
					() =>
						reject(
							failureToStudyError(
								this.#failure ?? {
									cause: 'interrupted',
									message: 'Study interrupted',
									role: undefined,
								},
							),
						),
					{ once: true, signal: listeners.signal },
				)
		}).finally(() => listeners.abort())
	}

	/** Removes the lifecycle listener without changing the retained failure. */
	close(): void {
		this.#listeners.abort()
	}

	#interrupt(): void {
		if (this.#failure === undefined)
			this.fail({
				cause: 'interrupted',
				message: 'Study interrupted by parent cancellation',
				role: undefined,
			})
	}
}
