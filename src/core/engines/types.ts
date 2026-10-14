import type {
	StudyAdmissionInterface,
	StudyCharge,
	StudyFailure,
	StudyLimit,
	StudyUsage,
} from '../types.js'

/** Owns the first operational failure and cancellation of enclosing work. */
export interface StudyControlInterface {
	readonly signal: AbortSignal
	readonly failure: StudyFailure | undefined
	/** Latches an operational failure and cancels all linked work.
	 * @param failure - The first attribution to preserve.
	 * @returns Nothing after failure propagation.
	 */
	fail(failure: StudyFailure): void
	/** Races work against cancellation and removes its listener after either ending.
	 * @param work - Work whose late rejection remains observed.
	 * @returns The result when work settles before cancellation.
	 */
	wait<T>(work: PromiseLike<T>): Promise<T>
	/** Removes the lifecycle listener without changing the retained failure.
	 * @returns Nothing after listener release.
	 */
	close(): void
}

/** Holds cumulative admission ceilings for one timed execution scope. */
export interface StudyScopeInterface {
	/** Checks cumulative consumption and every pending ceiling before admission.
	 * @param charge - The prospective request's ceilings, when supplied.
	 * @returns Nothing when admission remains possible.
	 */
	check(charge?: StudyCharge): void
	/** Reserves one request after the enclosing meter checked all scopes.
	 * @param id - The reservation identity.
	 * @param charge - The admitted ceilings.
	 * @returns Nothing after reservation.
	 */
	reserve(id: symbol, charge: StudyCharge): void
	/** Commits known charges while retaining ceilings for missing measurements.
	 * @param id - The pending reservation identity.
	 * @param usage - The retained public measurements.
	 * @returns Nothing after settlement.
	 */
	settle(id: symbol, usage: StudyUsage): void
	/** Checks deadline attribution before clearing the timer.
	 * @returns Nothing after resource release.
	 */
	close(): void
}

/** Owns request admission and the goal's terminal lifecycle. */
export interface StudyMeterInterface extends StudyAdmissionInterface {
	/** Refuses unfinished requests before closing a goal's admission boundary.
	 * @returns Nothing after admission closes.
	 */
	close(): void
}

/** Supplies one deadline and its shared failure owner. */
export interface StudyScopeOptions {
	readonly limit: StudyLimit
	readonly control: StudyControlInterface
	readonly label: string
}

/** Supplies the request allowance and all enclosing admission scopes. */
export interface StudyMeterOptions {
	readonly request: StudyLimit
	readonly scopes: readonly StudyScopeInterface[]
	readonly control: StudyControlInterface
}

/** Records the settlement of one admitted request. */
export type StudySettlementHandler = (usage: StudyUsage) => void

/** Supplies one admitted request with its shared failure owner and settlement sink. */
export interface StudyRequestOptions {
	readonly charge: StudyCharge
	readonly duration: number
	readonly control: StudyControlInterface
	readonly settle: StudySettlementHandler
}
