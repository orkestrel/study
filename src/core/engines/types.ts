import type { StudyCharge, StudyFailure, StudyLimit, StudyUsage } from '../types.js'

/** Owns the first operational failure and cancellation of enclosing work. */
export interface StudyControlInterface {
	readonly signal: AbortSignal
	readonly failure: StudyFailure | undefined
	fail(failure: StudyFailure): void
	wait<T>(work: PromiseLike<T>): Promise<T>
}

/** Holds cumulative admission ceilings for one timed execution scope. */
export interface StudyScopeInterface {
	check(charge?: StudyCharge): void
	reserve(id: symbol, charge: StudyCharge): void
	settle(id: symbol, usage: StudyUsage): void
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
