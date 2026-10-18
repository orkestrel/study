import type { StudyContext } from '../../core/types.js'

/** Holds one goal's parent context and the worker admission sequence it issues while the goal runs.
 * @example Issue worker admissions in sequence
 * ```ts
 * import type { StudyContext } from '@orkestrel/study'
 * import { StudyProcessGoal } from '@orkestrel/study/server'
 *
 * declare const context: StudyContext
 *
 * const goal = new StudyProcessGoal(context)
 * goal.issue(2) // undefined
 * goal.issue(1) // 1
 * goal.issue(1) // undefined
 * goal.issue(2) // 2
 * ```
 */
export class StudyProcessGoal {
	readonly #context: StudyContext
	#issued = 0

	/** Binds one goal to the parent meter and evidence sink it runs under.
	 * @param context - The actual parent meter, evidence sink and cancellation of the goal.
	 */
	constructor(context: StudyContext) {
		this.#context = context
	}

	/** Reports the parent meter and evidence sink the goal runs under. */
	get context(): StudyContext {
		return this.#context
	}

	/** Issues the identifier of the next worker admission when the worker asked for exactly that one.
	 * @param requested - The identifier the worker supplied.
	 * @returns The issued identifier, or undefined when the requested one is not the next in sequence.
	 */
	issue(requested: unknown): number | undefined {
		if (requested !== this.#issued + 1) return undefined
		this.#issued++
		return this.#issued
	}
}
