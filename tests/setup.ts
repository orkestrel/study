import type { RecorderInterface } from '@orkestrel/test'
import type {
	ProviderDelta,
	ProviderInterface,
	ProviderRequest,
	ProviderResult,
} from '@orkestrel/agent'
import type { JSONValue } from '@orkestrel/contract'
import type { StudyAgentObserver } from '../src/core/agents/StudyAgentObserver.js'
import type { StudyAgentMeasurement } from '../src/core/agents/types.js'
import type { StudyControl, StudyMeter, StudyScope } from '../src/core/engines/index.js'
import type { StudyTrialLease } from '../src/core/engines/StudyTrialLease.js'
import type { StudyError } from '../src/core/errors.js'
import type {
	StudyAttempt,
	StudyContext,
	StudyDriverInterface,
	StudyFailure,
	StudyGoal,
	StudyProduct,
	StudyStoreInterface,
	StudyTrial,
} from '../src/core/types.js'

/** Holds one inert Ollama protocol reply a fixture answers a path with. */
export interface OllamaReplyFixture {
	readonly path: string
	readonly body: string
	readonly status?: number
	/** If `true`, the response streams its body and stays open until the request aborts. */
	readonly open?: boolean
}

/** Holds one request a protocol fixture received, as its exact path and body bytes. */
export interface OllamaRequestFixture {
	readonly path: string
	readonly body: string
}

/** Holds a protocol-faithful fetch boundary and the requests it received. */
export interface OllamaFetchFixture {
	readonly fetch: typeof globalThis.fetch
	readonly requests: readonly OllamaRequestFixture[]
	/** Holds the queued replies the fixture has not served. */
	readonly replies: readonly OllamaReplyFixture[]
}

/** Holds inert terminal row fields; `fields` adds or replaces raw daemon fields of the row. */
export interface OllamaRowFixture {
	readonly content?: string
	readonly reason?: string
	readonly prompt?: number
	readonly completion?: number
	readonly unknown?: boolean
	readonly calls?: readonly JSONValue[]
	readonly fields?: Readonly<Record<string, JSONValue>>
}

/** Holds a real observing provider, the real provider it delegates to, and every reading it recorded. */
export interface AgentObserverFixture {
	readonly observer: StudyAgentObserver
	readonly inner: ProviderInterface
	readonly readings: readonly StudyAgentMeasurement[]
	/** Holds the exact pre-encoding request each reading measured, in reading order. */
	readonly requests: readonly ProviderRequest[]
}

/** Holds the deltas a drained stream yielded in order and the result it returned. */
export interface ProviderStreamFixture {
	readonly deltas: readonly ProviderDelta[]
	readonly result: ProviderResult
}

/** Holds a reply the observer must refuse and the failure it must carry. */
export interface AgentRefusalFixture {
	readonly name: string
	readonly row: OllamaRowFixture
}

/** Holds a recorded failure owner whose check can refuse with a supplied value. */
export interface StudyLatchFixture {
	readonly checks: RecorderInterface<readonly []>
	readonly failures: RecorderInterface<readonly [unknown]>
	check(): void
	fail(error: unknown): void
}

/** Holds a separately evaluated copy of the real study error module. */
export interface StudyErrorCopy {
	/** Holds the copy's own error class. */
	readonly error: unknown
	/** Constructs an error through the copy's own class. */
	readonly create: (...values: ConstructorParameters<typeof StudyError>) => unknown
	/** Applies the copy's own error guard. */
	readonly recognize: (value: unknown) => boolean
}

/** Declares one driver result against the output admission it must meet. */
export interface StudyAdmissionCase {
	/** Names the case in the test title. */
	readonly name: string
	/** If `true`, the driver outlasts the goal duration before it returns. */
	readonly expired: boolean
	/** If `true`, the returned value exceeds the goal output allowance. */
	readonly oversized: boolean
	/** Names the cause the first terminal failure must carry. */
	readonly cause: StudyFailure['cause']
	/** Holds the product the first observation must retain. */
	readonly product: StudyProduct | undefined
}

/** Holds real admission primitives and their owned cleanup boundary. */
export interface StudyMeterFixture {
	readonly control: StudyControl
	readonly scopes: readonly StudyScope[]
	readonly meter: StudyMeter
	close(): void
}

/** Configures the consumer-side driver boundary fixture. */
export interface StudyDriverFixtureOptions {
	/** Replaces the default goal execution after the goal id is recorded. */
	readonly execute?: (goal: StudyGoal, context: StudyContext) => Promise<StudyProduct>
	/** Delays each open result until the caller resolves it. */
	readonly opening?: Promise<void>
	/** Rejects each open with the supplied error after the call is recorded. */
	readonly refuse?: Error
	/** Rejects each session close with the supplied error after the call is recorded. */
	readonly closing?: Error
}

/** Holds a driver whose every boundary call is recorded. */
export interface StudyDriverFixture {
	readonly driver: StudyDriverInterface
	readonly opened: RecorderInterface<readonly [StudyTrial]>
	readonly executed: RecorderInterface<readonly [string]>
	readonly closed: RecorderInterface<readonly [string]>
}

/** Holds one trial's lease over recording boundary fixtures and its owned failure owner. */
export interface StudyLeaseFixture {
	readonly lease: StudyTrialLease
	readonly control: StudyControl
	readonly driver: StudyDriverFixture
	readonly custody: StudyStoreFixture
	readonly trial: StudyTrial
	close(): void
}

/** Holds an in-memory custody consumer whose every boundary call is recorded. */
export interface StudyStoreFixture {
	readonly store: StudyStoreInterface
	readonly started: RecorderInterface<readonly [StudyTrial]>
	readonly attempts: RecorderInterface<readonly [StudyAttempt]>
}
