import type { StudyEvidence } from '@src/core'
import type { JSONValue } from '@orkestrel/contract'
import type { StudyAgentStamp } from './types.js'

/** Holds one goal's retained trace rows, its latest admission and its last refused identity. */
export class StudyAgentTraceGoal {
	readonly #goal: string
	readonly #rows: StudyEvidence[] = []
	#admission: StudyAgentStamp | undefined
	#refused: unknown

	/** Binds the rows that follow to one goal.
	 * @param goal - The goal whose rows follow.
	 */
	constructor(goal: string) {
		this.#goal = goal
	}

	/** Reports the goal the rows belong to. */
	get goal(): string {
		return this.#goal
	}

	/** Reports every row retained so far; the same live view for the goal's whole life, which sees each row retained later. */
	get rows(): readonly StudyEvidence[] {
		return this.#rows
	}

	/** Reports the goal's latest admission stamp; undefined before one, or when the latest was not observed. */
	get admission(): StudyAgentStamp | undefined {
		return this.#admission
	}

	/** Retains one row for the goal.
	 * @param event - The evidence event name.
	 * @param value - The JSON evidence value.
	 */
	append(event: string, value: JSONValue): void {
		this.#rows.push({ event, goal: this.#goal, value })
	}

	/** Retains the goal's latest admission stamp.
	 * @param stamp - The admission measurement's stamp; undefined when it was not observed.
	 */
	admit(stamp: StudyAgentStamp | undefined): void {
		this.#admission = stamp
	}

	/** Latches a refused failure identity.
	 * @param error - The refused value.
	 * @returns True if it differs from the last refused identity; false otherwise.
	 */
	refuse(error: unknown): boolean {
		if (this.#refused === error) return false
		this.#refused = error
		return true
	}
}
