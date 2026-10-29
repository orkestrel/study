import type {
	LedgerGauge,
	ProviderInterface,
	ProviderRequest,
	estimateRequest,
	isAgentError,
	measureRequest,
} from '@orkestrel/agent'

/**
 * Holds the admitted Agent namespace capabilities the shared instrumentation invokes.
 * @remarks
 * Each member has the exact signature of the export of the same name in the selected Agent
 * runtime. The consumer supplies the admitted namespace; the instrumentation never imports a
 * runtime value from an installed Agent copy. No Ledger capability is required.
 */
export interface StudyAgentRuntime {
	readonly estimateRequest: typeof estimateRequest
	readonly measureRequest: typeof measureRequest
	readonly isAgentError: typeof isAgentError
}

/** Holds one dispatched request's explicit size reading. */
export interface StudyAgentMeasurement {
	/** Holds the runtime's estimate of the complete pre-encoding request. */
	readonly estimate: number
	/** Holds the gauge projection of that estimate; undefined when no gauge applies. */
	readonly projected: number | undefined
}

/** Receives one reading and the exact pre-encoding request it measured. */
export type StudyAgentRecordHandler = (
	reading: StudyAgentMeasurement,
	request: ProviderRequest,
) => void

/**
 * Holds the observing provider's delegate, measurement seam and explicit policies.
 * @remarks
 * `provider` receives every call unchanged. `runtime` measures each request. `gauge` prices each
 * reading; undefined prices nothing. `enforced` selects the usage policy: if `true`, a successful,
 * unaborted return must report a usable actual prompt count; if `false`, the observer reads usage
 * passively and refuses nothing. `record` receives exactly one reading, synchronously, before
 * each delegated call.
 */
export interface StudyAgentObserverOptions {
	readonly provider: ProviderInterface
	readonly runtime: Pick<StudyAgentRuntime, 'estimateRequest'>
	readonly gauge: LedgerGauge | undefined
	readonly enforced: boolean
	readonly record: StudyAgentRecordHandler
}

/** Holds the trial-local canonical dispatch identity a wire request joins to. */
export interface StudyAgentDispatch {
	readonly id: number
	/** Holds the SHA-256 revision of the canonical request, or undefined when it could not be rendered. */
	readonly revision: string | undefined
}

/** Retains the first operational failure of instrumented work and refuses work after it. */
export interface StudyLatchInterface {
	/** Refuses work after a retained failure or cancellation.
	 * @returns Nothing when work may continue.
	 */
	check(): void
	/** Retains an operational failure even when an enclosing runtime catches it.
	 * @param error - The observed failure; an earlier retained failure keeps its identity, and a branded `BudgetError` can retain nothing because Agent reports that stop in its own result.
	 * @returns Nothing after retention.
	 */
	fail(error: unknown): void
}
