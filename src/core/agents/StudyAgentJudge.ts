import type { JudgeInterface, JudgeRequest, JudgeResult } from '@orkestrel/agent'
import type { StudyLatchInterface } from './types.js'

/** Latches a real judge's failure before an enclosing runtime can treat it as absent. */
export class StudyAgentJudge implements JudgeInterface {
	readonly #judge: JudgeInterface
	readonly #latch: StudyLatchInterface

	/** Binds a real public judge to the trial's failure owner.
	 * @param judge - The admitted judge every question is delegated to.
	 * @param latch - The owner that retains the first operational failure.
	 */
	constructor(judge: JudgeInterface, latch: StudyLatchInterface) {
		this.#judge = judge
		this.#latch = latch
	}

	/** Reports the delegate's trace label. */
	get id(): string {
		return this.#judge.id
	}

	/** Reports the delegate's backend name. */
	get name(): string {
		return this.#judge.name
	}

	/** Reports the delegate's model identity. */
	get model(): string {
		return this.#judge.model
	}

	/** Refuses dispatch after a retained failure and retains a thrown failure with its identity.
	 * @param request - The real classification request.
	 * @param signal - The caller's cancellation.
	 * @returns The unmodified judge result.
	 */
	async ask(request: JudgeRequest, signal: AbortSignal): Promise<JudgeResult> {
		this.#latch.check()
		try {
			return await this.#judge.ask(request, signal)
		} catch (error) {
			this.#latch.fail(error)
			throw error
		}
	}
}
