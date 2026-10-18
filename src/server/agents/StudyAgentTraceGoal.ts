import type { JSONValue } from '@orkestrel/contract'
import type { StudyEvidence, StudySinkInterface } from '../../core/types.js'
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

	/** Appends every retained row in order, including rows retained while earlier rows are being appended.
	 * @param evidence - The sink that takes custody of each row.
	 * @returns Completion after the last row; rejects with the first custody refusal and appends nothing after it.
	 */
	async flush(evidence: StudySinkInterface): Promise<void> {
		for (const row of this.#rows) await evidence.append(row)
	}
}
