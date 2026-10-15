import type {
	StudyCause,
	StudyContext,
	StudyEvidence,
	StudyUsage,
} from '../../../../src/core/types.js'
import type { StudyOllamaPolicy } from '../../../../src/server/ollama/types.js'
import type { StudyOllamaTransport } from '../../../../src/server/ollama/StudyOllamaTransport.js'
import type { StudyMeterFixture } from '../../core/engines/types.js'
import type { OllamaReplyFixture, OllamaRequestFixture } from '../../core/agents/types.js'

/** Holds a loopback Ollama protocol fixture and the exact requests it received. */
export interface OllamaServerFixture {
	readonly url: string
	readonly requests: readonly OllamaRequestFixture[]
	/** Holds the incoming `x-study-owned` header value for each received request. */
	readonly owned: ReadonlyArray<string | undefined>
	/** Holds the queued replies the fixture has not served. */
	readonly replies: readonly OllamaReplyFixture[]
	close(): Promise<void>
}

/** Holds caller-owned strict role declarations a test mutates after construction. */
export interface OllamaStrictRolesFixture {
	readonly agent: StudyOllamaPolicy
}

/** Holds real goal accounting with append-only evidence and one cleanup boundary. */
export interface OllamaContextFixture {
	readonly context: StudyContext
	readonly evidence: readonly StudyEvidence[]
	readonly meter: StudyMeterFixture
	/** Reads the settled usage of every admitted request without its elapsed clock. */
	usage(): ReadonlyArray<Omit<StudyUsage, 'duration'>>
	close(): void
}

/** Holds a prepared transport over a loopback fixture with real goal accounting and one cleanup boundary. */
export interface OllamaTransportFixture {
	readonly server: OllamaServerFixture
	readonly goal: OllamaContextFixture
	readonly transport: StudyOllamaTransport
	close(): Promise<void>
}

/** Holds a 200 response body whose reading must fail, and the failure the transport must retain. */
export interface OllamaStreamFailureFixture {
	readonly name: string
	readonly body: string
	/** Holds a substring of the retained failure message. */
	readonly message: string
	readonly cause: StudyCause
}

/** Holds a non-2xx response and the failure the transport must throw after reading it. */
export interface OllamaStatusFailureFixture {
	readonly name: string
	readonly status: number
	readonly body: string
	readonly code: 'CAPACITY' | 'FAULT'
	/** Holds a substring of the thrown failure message. */
	readonly message: string
}

/** Holds one native error value, the status it arrived with, and the failure it must read as. */
export interface OllamaFailureFixture {
	readonly name: string
	readonly value: unknown
	readonly status?: number
	readonly code: 'CAPACITY' | 'FAULT'
	/** Holds substrings the readable reason must contain, such as the native message and type. */
	readonly reason: readonly string[]
}
