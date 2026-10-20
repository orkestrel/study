import type { StudySinkInterface, StudyAgentDispatch, StudyAgentReading } from '@src/core'
import type { LedgerGauge, ProviderRequest } from '@orkestrel/agent'
import type { JSONValue } from '@orkestrel/contract'
import type {
	StudyAgentRole,
	StudyAgentStage,
	StudyAgentStamp,
	StudyAgentTraceOptions,
} from './types.js'
import {
	buildStudyAgentParts,
	projectStudyAgentRequest,
	translateStudyAgentError,
	StudyError,
} from '@src/core'
import { buildStudyAgentRevision } from './helpers.js'
import { StudyAgentTraceGoal } from './StudyAgentTraceGoal.js'

/** Correlates measured Agent requests and retains their evidence across a trial's goals. */
export class StudyAgentTrace {
	readonly #options: StudyAgentTraceOptions
	// Dispatch identities per role; one current dispatch cannot be overtaken by another of its role
	// because the consumer awaits each request before the next of that role.
	// Each dispatch replaces the map, so a reader never sees one change in place.
	#slots: ReadonlyMap<StudyAgentRole, StudyAgentDispatch> = new Map()
	// The goal in flight; `start` binds it and its flush releases it when it settles.
	#goal: StudyAgentTraceGoal | undefined
	// The goals being flushed; a goal joins when its flush starts and leaves when the flush settles.
	readonly #flushes = new Set<StudyAgentTraceGoal>()
	#ordinal = 0
	#dispatches = 0

	/** Binds the measuring runtime, the failure owner and the consumer origin join.
	 * @param options - Runtime, latch, observation switch and origin handler.
	 */
	constructor(options: StudyAgentTraceOptions) {
		this.#options = { ...options }
	}

	/** Reports the active goal; undefined between goals. */
	get goal(): string | undefined {
		return this.#goal?.goal
	}

	/** Begins a goal's rows. Ordinals, dispatch numbers and role identities continue from earlier goals.
	 * @param goal - The goal whose rows follow.
	 * @throws StudyError - Thrown with code `CONFIG` when a goal is already active; the active goal and its rows stay unchanged.
	 */
	start(goal: string): void {
		if (this.#goal !== undefined) throw new StudyError('CONFIG', 'Trace goal is already active')
		this.#goal = new StudyAgentTraceGoal(goal)
	}

	/** Retains one domain row for the active goal, whether or not observation is enabled; a row outside a goal is dropped.
	 * @param event - The evidence event name.
	 * @param value - The JSON evidence value.
	 */
	append(event: string, value: JSONValue): void {
		this.#goal?.append(event, value)
	}

	/** Appends the retained rows in order, including rows added during the flush, and ends the goal even when custody refuses a row.
	 * @param evidence - The sink that takes custody of each row.
	 * @returns Completion after every row is appended; immediately when no goal is active.
	 * @throws StudyError - Thrown with code `CONFIG` when another flush is pending; the pending flush is untouched.
	 */
	async flush(evidence: StudySinkInterface): Promise<void> {
		const running = this.#goal
		if (running === undefined) return
		if (this.#flushes.size !== 0) throw new StudyError('CONFIG', 'Trace flush is already pending')
		// The goal joins the registry before the sink can run, so a sink that re-enters `flush` meets it.
		this.#flushes.add(running)
		try {
			for (const row of running.rows) await evidence.append(row)
		} finally {
			this.#goal = undefined
			this.#flushes.delete(running)
		}
	}

	/** Prices a window measurement and, when observing, retains it as the goal's admission.
	 * @param request - The measured request.
	 * @param gauge - The explicit gauge pricing the estimate.
	 * @returns The projected prompt tokens.
	 */
	admit(request: ProviderRequest, gauge: LedgerGauge): number {
		const estimate = this.#options.runtime.estimateRequest(request)
		const projected = projectStudyAgentRequest(gauge, estimate)
		const stamp = this.measure('admission', 'agent', request, { estimate, projected }, undefined)
		this.#goal?.admit(stamp)
		return projected
	}

	/** Retains a dispatching agent request's reading, names it for the wire request that follows, and records its estimate.
	 * @param reading - The explicit size reading.
	 * @param request - The exact pre-encoding request.
	 */
	record(reading: StudyAgentReading, request: ProviderRequest): void {
		const goal = this.#observed()
		if (goal === undefined) return
		const dispatch = this.#number('agent', request, reading)
		goal.append('estimate', {
			estimate: reading.estimate,
			projected: reading.projected ?? null,
			revision: dispatch.revision ?? null,
			dispatch: dispatch.id,
		})
	}

	/** Takes one synchronous measurement row; the goal's flush appends it, failure included.
	 * @param stage - Where the measurement was taken.
	 * @param role - The responsibility whose request was measured.
	 * @param request - The exact pre-encoding request.
	 * @param reading - The explicit size reading.
	 * @param dispatch - The dispatch number the request received; undefined for an admission.
	 * @returns The ordinal and revision; undefined when not observing.
	 */
	measure(
		stage: StudyAgentStage,
		role: StudyAgentRole,
		request: ProviderRequest,
		reading: StudyAgentReading,
		dispatch: number | undefined,
	): StudyAgentStamp | undefined {
		const goal = this.#observed()
		if (goal === undefined) return undefined
		const ordinal = ++this.#ordinal
		const revision = buildStudyAgentRevision(request) ?? null
		goal.append('context', {
			stage,
			role,
			ordinal,
			revision,
			estimate: reading.estimate,
			projected: reading.projected ?? null,
			...(dispatch === undefined ? {} : { dispatch }),
			parts: buildStudyAgentParts(this.#options.runtime.measureRequest(request)),
			origins: this.#options.origins(request.messages),
		})
		return { ordinal, revision }
	}

	/** Numbers a request about to be dispatched and retains it as its role's current dispatch; does nothing unless observing.
	 * @param role - The responsibility dispatching.
	 * @param request - The exact pre-encoding request.
	 * @param reading - The explicit size reading.
	 */
	dispatch(role: StudyAgentRole, request: ProviderRequest, reading: StudyAgentReading): void {
		if (this.#observed() === undefined) return
		this.#number(role, request, reading)
	}

	/** Reads the role's current dispatch identity for the wire request that follows it.
	 * @param role - The responsibility dispatching.
	 * @returns The dispatch id and revision; undefined before any observed dispatch of the role.
	 */
	canonical(role: StudyAgentRole): StudyAgentDispatch | undefined {
		return this.#slots.get(role)
	}

	/** Latches the study-level reading of a failure before an enclosing runtime can swallow it and retains one refusal row per refused identity in a goal.
	 * @param error - The caught or reported value.
	 * @returns The translated failure, or the same value when it is not an Agent window refusal.
	 */
	translate(error: unknown): unknown {
		const translated = translateStudyAgentError(error, this.#options.runtime)
		this.#refuse(error, translated)
		this.#options.latch.fail(translated)
		return translated
	}

	// Reads the active goal only while observation is enabled.
	#observed(): StudyAgentTraceGoal | undefined {
		return this.#options.observe ? this.#goal : undefined
	}

	// Numbers the dispatch, retains its context row and makes it the role's current identity.
	#number(
		role: StudyAgentRole,
		request: ProviderRequest,
		reading: StudyAgentReading,
	): StudyAgentDispatch {
		const id = ++this.#dispatches
		const stamp = this.measure('dispatch', role, request, reading, id)
		const dispatch = Object.freeze({ id, revision: stamp?.revision ?? undefined })
		this.#slots = new Map([...this.#slots, [role, dispatch]])
		return dispatch
	}

	// Retains one refusal row per refused error identity in a goal, however many callbacks it traverses.
	#refuse(error: unknown, translated: unknown): void {
		const goal = this.#observed()
		if (translated === error || goal === undefined || !goal.refuse(error)) return
		const context = this.#options.runtime.isAgentError(error) ? error.context : undefined
		goal.append('refusal', {
			cause: 'capacity',
			role: 'agent',
			ordinal: goal.admission?.ordinal ?? null,
			revision: goal.admission?.revision ?? null,
			consumed: typeof context?.consumed === 'number' ? context.consumed : null,
			max: typeof context?.max === 'number' ? context.max : null,
		})
	}
}
