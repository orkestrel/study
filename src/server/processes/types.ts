import type {
	StudyIdentity,
	StudyProfile,
	StudyTicket,
	StudyTrial,
	StudyUsage,
	StudyFailure,
	StudyAdmissionInterface,
	StudyControl,
} from '@src/core'
import type { StudyChannel } from './StudyChannel.js'
import type { JSONValue } from '@orkestrel/contract'
import type { ChildProcess } from 'node:child_process'
import type { StudyValidation, StudyAdjudication } from '../adapters/types.js'

/** Holds a bounded adapter-only native operation. */
export interface StudyTaskOptions {
	readonly entry: string
	readonly root: string
	readonly adapter: string
	readonly roots: readonly string[]
	readonly duration?: number
}

/** Carries only declarations or sealed evidence to an adapter child. */
export type StudyTaskRequest =
	| { readonly operation: 'validate'; readonly input: StudyValidation }
	| { readonly operation: 'grade'; readonly input: StudyAdjudication }

/** Returns adapter output with the exact active instrumentation digest. */
export interface StudyTaskResult {
	readonly instrument: string
	readonly value: JSONValue
}

/** Holds the trusted instrument and caller-selected built artifact locations. */
export interface StudyArtifactLoaderOptions {
	readonly entry: string
	readonly root: string
	readonly profile: StudyProfile
	readonly adapter: string
}

/** Holds the separately bound instrument and selected module inventory identities. */
export interface StudyArtifactIdentity {
	readonly agent: string
	readonly subject: string
	readonly provider: string | undefined
	readonly instrument: string
}

/** Holds actual namespaces loaded only during worker execution. */
export interface StudyArtifactModule {
	readonly agent: unknown
	readonly subject: unknown
	readonly provider: unknown
}

/** Holds the parent-owned fresh trial process configuration. */
export interface StudyProcessOptions extends StudyArtifactLoaderOptions {
	readonly identity: StudyIdentity
	readonly driver: string
	readonly directory: string
}

/** Names the bounded transport's domain operations. */
export type StudyOperation = 'open' | 'goal' | 'close' | 'admit' | 'finish' | 'fail' | 'evidence'

/** Holds a correlated JSON request, reply or cancellation notification. */
export interface StudyFrame {
	readonly id: number
	readonly operation: StudyOperation | 'reply' | 'error' | 'abort'
	readonly value: JSONValue
}

/** Handles validated transport requests at their owning domain boundary. */
export type StudyMessageHandler = (
	operation: StudyOperation,
	value: JSONValue,
) => Promise<JSONValue>

/** Holds one native IPC endpoint and its domain handlers. */
export interface StudyChannelOptions {
	readonly endpoint: ChildProcess | NodeJS.Process
	readonly handle: StudyMessageHandler
	readonly abort: (value: JSONValue) => void
}

/** Holds an outstanding bounded IPC response. */
export interface StudyResponse {
	readonly resolve: (value: JSONValue) => void
	readonly reject: (error: unknown) => void
}

/** Holds one fresh child trial's launch parameters and cancellation. */
export interface StudyProcessSessionOptions extends StudyProcessOptions {
	readonly trial: StudyTrial
	readonly signal: AbortSignal
}

/** Holds an authoritative parent ticket and its transport listener lifetime. */
export interface StudyParentTicket {
	readonly ticket: StudyTicket
	readonly listeners: AbortController
}

/** Holds the worker meter's parent-authorized transport and failure latch. */
export interface StudyRemoteMeterOptions {
	readonly channel: StudyChannel
	readonly control: StudyControl
}

/** Owns transported admission, parent cancellation, and settlement drainage. */
export interface StudyRemoteMeterInterface extends StudyAdmissionInterface {
	/** Propagates the parent's ticket cancellation without changing its cause.
	 * @param id - The parent-issued ticket identity.
	 * @param failure - The authoritative parent attribution.
	 * @returns Nothing after cancellation propagation.
	 */
	abort(id: number, failure: StudyFailure): void
	/** Closes admission and requires every ticket and acknowledgment to finish.
	 * @returns A promise that resolves after acknowledged settlements drain.
	 */
	close(): Promise<void>
}

/** Holds one transported ticket's identity and settlement owner. */
export interface StudyRemoteTicketOptions {
	readonly id: number
	readonly signal: AbortSignal
	readonly settle: (operation: 'finish' | 'fail', value: StudyUsage | StudyFailure) => void
}
