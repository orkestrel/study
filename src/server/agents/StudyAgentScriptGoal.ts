import type { StudyAgentPlan, StudyAgentResponse } from './types.js'

/** Serves one goal's owned response sequence in declared order. */
export class StudyAgentScriptGoal {
	readonly #plan: StudyAgentPlan
	#cursor = 0

	/** Binds one goal's owned plan.
	 * @param plan - The validated plan whose response snapshot the provider owns.
	 */
	constructor(plan: StudyAgentPlan) {
		this.#plan = plan
	}

	/** Reports the goal's owned plan. */
	get plan(): StudyAgentPlan {
		return this.#plan
	}

	/** Takes the next declared response and advances past it.
	 * @returns The response; undefined after the sequence is exhausted, which it then stays.
	 */
	take(): StudyAgentResponse | undefined {
		const response = this.#plan.responses[this.#cursor]
		if (response !== undefined) this.#cursor++
		return response
	}
}
