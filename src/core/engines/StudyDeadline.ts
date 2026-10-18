import type { StudyDeadlineInterface, StudyDeadlineOptions } from './types.js'
import { StudyControl } from './StudyControl.js'
import { StudyScope } from './StudyScope.js'

/** Bounds each independent operation with a fresh failure owner and deadline. */
export class StudyDeadline implements StudyDeadlineInterface {
	#options: StudyDeadlineOptions

	/** Retains the deadline without starting a timer.
	 * @param options - Finite duration in milliseconds and diagnostic label.
	 */
	constructor(options: StudyDeadlineOptions) {
		this.#options = { ...options }
	}

	/** Waits for work under a fresh failure owner and releases its timer and listener.
	 * @param work - Already-started work whose late rejection remains observed.
	 * @returns The work's result when it settles before the deadline.
	 * @throws Thrown for an invalid duration, the work's own rejection, or the labelled deadline.
	 */
	async wait<T>(work: PromiseLike<T>): Promise<T> {
		const control = new StudyControl()
		const scope = this.#open(control, work)
		try {
			const result = await control.wait(work)
			scope.check()
			return result
		} finally {
			scope.close()
			control.close()
		}
	}

	// Opens the deadline scope; an invalid duration closes the owner and keeps the work's late rejection observed.
	#open(control: StudyControl, work: PromiseLike<unknown>): StudyScope {
		try {
			return new StudyScope({
				limit: { duration: this.#options.duration, calls: 1, tokens: 1, bytes: 1 },
				control,
				label: this.#options.label,
			})
		} catch (error) {
			Promise.resolve(work).catch(() => undefined)
			control.close()
			throw error
		}
	}
}
