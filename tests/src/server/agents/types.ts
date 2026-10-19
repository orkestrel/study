import type { AgentResult, LedgerGauge } from '@orkestrel/agent'
import type { RecorderInterface } from '@orkestrel/test'
import type { StudyAttempt, StudyEvidence, StudySinkInterface } from '../../../../src/core/types.js'
import type { StudyAgentPlan } from '../../../../src/server/agents/types.js'
import type { StudyAgentSummary } from '../../../../src/server/agents/StudyAgentSummary.js'
import type { StudyAgentTrace } from '../../../../src/server/agents/StudyAgentTrace.js'
import type {
	OllamaFetchFixture,
	OllamaReplyFixture,
	StudyLatchFixture,
} from '../../core/agents/types.js'

/** Holds terminal custody and the real Agent results observed before stop translation. */
export interface StudyAgentSeriesResult {
	readonly attempts: readonly StudyAttempt[]
	readonly results: readonly AgentResult[]
}

/**
 * Holds the custody refusal and the append hook a sink fixture applies.
 * @remarks
 * `refuse` throws its error on the zero-based appended row before retaining it. `during` runs at the
 * start of every append, before the refusal check.
 */
export interface StudySinkFixtureOptions {
	readonly refuse?: { readonly error: unknown; readonly row: number }
	readonly during?: () => void | Promise<void>
}

/** Holds an evidence sink, the rows it accepted in order, and every row offered to it, a refused one included. */
export interface StudySinkFixture {
	readonly sink: StudySinkInterface
	readonly rows: readonly StudyEvidence[]
	readonly offered: readonly StudyEvidence[]
}

/** Holds a real trace and the recorded failure owner it latches through. */
export interface StudyAgentTraceFixture {
	readonly trace: StudyAgentTrace
	readonly latch: StudyLatchFixture
}

/**
 * Holds the wire replies, observation switch, prompt limit and cancellation a summary fixture applies.
 * @remarks
 * `replies` are the queued protocol answers of the real provider's wire. `observe` is the trace's
 * observation switch. `limit` is the summary's prompt projection limit. `signal` is the summary's
 * own cancellation; omitted, a live signal is used. `gauge` prices each request; omitted, the
 * fixture gauge that projects every fixture request at the declared projection is used. `refusal` wraps the value the latch's check
 * throws; omitted, work continues.
 */
export interface StudyAgentSummaryFixtureOptions {
	readonly replies: readonly OllamaReplyFixture[]
	readonly observe: boolean
	readonly limit: number
	readonly signal?: AbortSignal
	readonly gauge?: LedgerGauge
	readonly refusal?: { readonly error: unknown }
}

/** Holds a real summary, the real trace and latch it reports through, and the wire its provider sends on. */
export interface StudyAgentSummaryFixture extends StudyAgentTraceFixture {
	readonly summary: StudyAgentSummary
	readonly wire: OllamaFetchFixture
}

/** Holds a scripted plan, the evidence rows its context retained, and its separate workload controller. */
export interface StudyScriptFixture {
	readonly plan: StudyAgentPlan
	readonly rows: RecorderInterface<readonly [StudyEvidence]>
	readonly workload: AbortController
}

/** Holds one chat message of a request body as the wire carried it. */
export interface StudyOllamaMessageFixture {
	readonly role: string
	readonly content: string
}
