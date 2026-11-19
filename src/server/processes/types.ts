import type {
	StudyAttempt,
	StudyIdentity,
	StudyProfile,
	StudyRubric,
	StudyTicketInterface,
	StudyTrial,
	StudyUsage,
	StudyFailure,
	StudyAdmissionInterface,
	StudyControl,
} from '@src/core'
import type { StudyChannel } from './StudyChannel.js'
import type { JSONValue } from '@orkestrel/contract'
import type { ChildProcess } from 'node:child_process'
import type { StudyValidation, StudyProgressTarget } from '../adapters/types.js'
import type { StudyClosure } from '../commands/types.js'
import type { StudyExchangeDestination, StudySealedCustody } from '../stores/types.js'
import type { StudyOllamaKeyedSelection, StudyOllamaReplaySelection } from '../ollama/types.js'

/** Holds a bounded adapter-only native operation. */
export interface StudyTaskOptions {
	readonly entry: string
	readonly root: string
	readonly adapter: string
	readonly roots: readonly string[]
	readonly duration?: number
	/** Binds fresh adapter validation to the already verified relocated selection. */
	readonly closure?: StudyClosure
}

/** Names a verified sealed result and its rubric, so a grading child reads and verifies the result's evidence itself.
 * @remarks
 * The child reads each scheduled trial's `evidence.jsonl` under `directory` within the manifest's
 * trial byte bound, and refuses with `CUSTODY` a file whose digest differs from its `seal` entry.
 * It then resolves the manifest's `host.entry` keys against its working root and refuses with
 * `CONFIG` when an agent, subject, or provider bundle identity differs from the manifest's; it
 * compares no instrument, so another Study executable or adapter grades.
 */
export interface StudyGradeInput extends StudySealedCustody {
	readonly attempts: readonly StudyAttempt[]
	readonly rubric: StudyRubric
}

/** Holds the progress targets an adapter child reads, each one listed goal's complete evidence rows. */
export interface StudyTaskTargets {
	readonly targets: readonly StudyProgressTarget[]
}

/** Requests an adapter child's validation of a study's declarations. */
export interface StudyTaskValidate {
	readonly operation: 'validate'
	readonly input: StudyValidation
}

/** Requests an adapter child's grading of a verified sealed result. */
export interface StudyTaskGrade {
	readonly operation: 'grade'
	readonly input: StudyGradeInput
}

/** Requests an adapter child's progress projection of listed goals. */
export interface StudyTaskProgress {
	readonly operation: 'progress'
	readonly input: StudyTaskTargets
}

/** Carries declarations, a sealed result's custody, or progress evidence to an adapter child. */
export type StudyTaskRequest = StudyTaskValidate | StudyTaskGrade | StudyTaskProgress

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
	/** Selects relocated captured bytes and their checked identity instead of original paths. */
	readonly closure?: StudyClosure
}

/** Holds the parent-owned fresh trial process configuration. */
export interface StudyProcessOptions extends StudyArtifactLoaderOptions {
	readonly identity: StudyIdentity
	readonly driver: string
	readonly directory: string
	/** Names parent-reserved sidecars by scheduled trial; no recorded bodies cross IPC. */
	readonly exchanges?: Readonly<Record<string, StudyExchangeDestination>>
	/** Carries sealed source selection; each fresh worker rechecks its own trial's file. */
	readonly replay?: StudyOllamaReplaySelection
	/** Carries a keyed recording's selection; each fresh worker reverifies the sealed source. */
	readonly keyed?: StudyOllamaKeyedSelection
}

/** Prepares one trial's external resources before its worker starts.
 * @remarks
 * The execution owns daemon start and stop. This callback performs the declared pre-trial
 * unload and closes any maintenance prefix before returning its retained file identity.
 * A returned destination must preserve the supplied path and record allowance. The driver
 * awaits it before constructing the session and never serializes this callback over IPC.
 * Offline replay supplies no callback and starts no external resource.
 * @param trial - The exact scheduled trial about to open.
 * @param signal - The enclosing execution cancellation.
 * @param exchanges - The parent-reserved sidecar destination, when recording is declared.
 * @returns The same destination with verified maintenance-prefix identity, or undefined without recording.
 */
export type StudyTrialPreparationFunction = (
	trial: StudyTrial,
	signal: AbortSignal,
	exchanges: StudyExchangeDestination | undefined,
) => Promise<StudyExchangeDestination | undefined>

/** Supplies parent-only trial preparation separately from serializable worker options. */
export interface StudyProcessDriverOptions extends StudyProcessOptions {
	readonly prepare?: StudyTrialPreparationFunction
}

/** Names the bounded transport's domain operations. */
export type StudyOperation = 'open' | 'goal' | 'close' | 'admit' | 'finish' | 'fail' | 'evidence'

/** Names a frame's operation: a domain request, or the reply, error, or cancellation that answers one. */
export type StudyFrameOperation = StudyOperation | 'reply' | 'error' | 'abort'

/** Names the two operations that settle an admitted ticket. */
export type StudySettleOperation = Extract<StudyOperation, 'finish' | 'fail'>

/** Holds a correlated JSON request, reply or cancellation notification. */
export interface StudyFrame {
	readonly id: number
	readonly operation: StudyFrameOperation
	readonly value: JSONValue
}

/** Receives the value of a cancellation frame the peer sent. */
export type StudyAbortHandler = (value: JSONValue) => void

/** Receives the value a peer's reply carries to an outstanding request. */
export type StudyReplyHandler = (value: JSONValue) => void

/** Receives the error that ends an outstanding request. */
export type StudyRejectHandler = (error: unknown) => void

/** Records one transported ticket's settlement with its parent. */
export type StudySettleHandler = (
	operation: StudySettleOperation,
	value: StudyUsage | StudyFailure,
) => void

/** Handles validated transport requests at their owning domain boundary. */
export type StudyMessageHandler = (
	operation: StudyOperation,
	value: JSONValue,
) => Promise<JSONValue>

/** Holds one native IPC endpoint and its domain handlers. */
export interface StudyChannelOptions {
	readonly endpoint: ChildProcess | NodeJS.Process
	readonly handle: StudyMessageHandler
	readonly abort: StudyAbortHandler
}

/** Holds an outstanding bounded IPC response. */
export interface StudyResponse {
	readonly resolve: StudyReplyHandler
	readonly reject: StudyRejectHandler
}

/** Holds one fresh child trial's launch parameters and cancellation. */
export interface StudyProcessSessionOptions extends StudyProcessOptions {
	readonly trial: StudyTrial
	readonly signal: AbortSignal
	/** Carries the checkpoint row value the worker hands its driver at opening; absent opens fresh state. */
	readonly seed?: JSONValue
}

/** Holds an authoritative parent ticket and its transport listener lifetime. */
export interface StudyParentTicket {
	readonly ticket: StudyTicketInterface
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
	readonly settle: StudySettleHandler
}
