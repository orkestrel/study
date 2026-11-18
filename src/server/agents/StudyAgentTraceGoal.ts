import type { StudyEvidence } from '@src/core'
import type { JSONValue } from '@orkestrel/contract'

/** Holds one goal's retained trace rows. */
export class StudyAgentTraceGoal {
	readonly #goal: string
	readonly #rows: StudyEvidence[] = []

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

	/** Retains one row for the goal.
	 * @param event - The evidence event name.
	 * @param value - The JSON evidence value.
	 */
	append(event: string, value: JSONValue): void {
		this.#rows.push({ event, goal: this.#goal, value })
	}
}
