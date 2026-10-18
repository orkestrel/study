import type { JSONValue } from '@orkestrel/contract'
import type { StudyOllamaActivity } from './types.js'

/** Holds one goal's accounting boundary and whether its checkpoint has joined a dispatch row. */
export class StudyOllamaGoal {
	readonly #activity: StudyOllamaActivity
	#attached = false

	/** Binds one goal's accounting boundary.
	 * @param activity - The goal's admitted activity; it is held by reference.
	 */
	constructor(activity: StudyOllamaActivity) {
		this.#activity = activity
	}

	/** Reports the goal's accounting boundary. */
	get activity(): StudyOllamaActivity {
		return this.#activity
	}

	/** Hands out the goal's checkpoint for its first observed dispatch.
	 * @returns The checkpoint the first time it is asked for; undefined afterwards and whenever the goal has none.
	 */
	attach(): JSONValue | undefined {
		const checkpoint = this.#activity.checkpoint
		if (checkpoint === undefined || this.#attached) return undefined
		this.#attached = true
		return checkpoint
	}
}
