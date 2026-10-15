import type { RecorderInterface } from '@orkestrel/test'
import type {
	ProviderDelta,
	ProviderInterface,
	ProviderRequest,
	ProviderResult,
} from '@orkestrel/agent'
import type { JSONValue } from '@orkestrel/contract'
import type { StudyAgentObserver } from '../../../../src/core/agents/StudyAgentObserver.js'
import type { StudyAgentReading } from '../../../../src/core/agents/types.js'

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
	readonly readings: readonly StudyAgentReading[]
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
