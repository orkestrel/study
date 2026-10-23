import type {
	StudyAttempt,
	StudyManifest,
	StudyProduct,
	StudySinkInterface,
	StudyStoreInterface,
	StudyRecord,
	StudyRole,
	StudyTrial,
} from '@src/core'
import type {
	StudyOllamaMetadata,
	StudyOllamaModel,
	StudyOllamaStage,
	StudyOllamaStep,
} from '../ollama/types.js'
import type { FileHandle } from 'node:fs/promises'
import type { JSONValue } from '@orkestrel/contract'

/** Holds the inert execution store configuration. */
export interface StudyResultStoreOptions {
	readonly directory: string
	readonly manifest: StudyManifest
}

/** Owns execution custody from exclusive creation through complete sealing. */
export interface StudyResultStoreInterface extends StudyStoreInterface {
	/** Exclusively creates the result directory and initial manifest bytes.
	 * @returns A promise that resolves after the manifest is synchronized.
	 */
	create(): Promise<void>
	/** Seals a complete terminal population with its exact execution-byte inventory.
	 * @returns The synchronized execution seal.
	 */
	seal(): Promise<StudySeal>
	/** Reserves a declared trial's sidecar allowance and returns its exclusive write destination.
	 * @param trial - A scheduled trial whose recording declaration is present.
	 * @returns The destination after reserving its complete allowance from series custody.
	 */
	exchanges?(trial: StudyTrial): Promise<StudyExchangeDestination>
}

/** Holds the parent-reserved destination of one trial's exchange sidecar.
 * @remarks
 * Path is absolute and ends in execution/trials/<trial>/exchanges.jsonl. The parent reserves
 * record.bytes against series custody before the worker starts. Without retained, the worker
 * opens the absent file exclusively. With retained, staging has closed a declaration and
 * maintenance prefix; the worker verifies that file identity and resumes appending after it.
 * Only file identities and declarations cross IPC, never a sidecar's recorded bodies.
 */
export interface StudyExchangeDestination {
	readonly path: string
	readonly record: StudyRecord
	readonly retained?: StudyFile
}

/** Retains an application HTTP body's exact bytes independently of text decoding.
 * @remarks
 * Body is canonical base64, digest is lowercase SHA-256 of decoded bytes, and size is their safe
 * byte count. An empty body has size zero and the digest of empty bytes. This representation
 * retains no TLS records or HTTP transfer framing.
 */
export interface StudyExchangeBytes {
	readonly body: string
	readonly digest: string
	readonly size: number
}

/** Binds one HTTP exchange to its trial-local position and declared execution stage.
 * @remarks
 * Ordinal is contiguous and one-based across all HTTP exchanges, including metadata and
 * maintenance. Step is present only for execution and names the model procedure's ordinal.
 * Goal names the declared goal whose evidence joins the exchange; pre-trial maintenance uses
 * the trial's first declared goal. Path excludes origin, query, and fragment. Every attempt and
 * terminal repeats this identity exactly, and dispatch and wire evidence retain ordinal even
 * when passive observation is disabled.
 */
export interface StudyExchangeIdentity {
	readonly ordinal: number
	readonly goal: string
	readonly role: StudyRole
	readonly path: '/api/chat' | '/api/generate' | '/api/version' | '/api/tags' | '/api/show'
	readonly method: 'GET' | 'POST'
	readonly stage: StudyOllamaStage
	readonly step?: number
}

/** Declares the complete trial procedure before any exchange attempt is appended.
 * @remarks
 * This is the first sidecar row. Version and models pin both verification passes. Procedure
 * contains every model step in order. Metadata declares an independent budget. Maintenance
 * declares each model to unload before preflight; it is empty when no daemon is owned.
 * Preflight and postflight each require version, tags, and one show per distinct model, in
 * that order. No model attempt precedes preflight or follows postflight.
 */
export interface StudyExchangeDeclaration {
	readonly phase: 'declaration'
	readonly trial: string
	readonly version: string
	readonly models: Readonly<Record<string, StudyOllamaModel>>
	readonly metadata: StudyOllamaMetadata
	readonly procedure: readonly StudyOllamaStep[]
	readonly maintenance: readonly StudyOllamaModel[]
}

/** Retains admitted request bytes durably before the corresponding send begins. */
export interface StudyExchangeAttempt extends StudyExchangeIdentity, StudyExchangeBytes {
	readonly phase: 'attempt'
}

/** Retains response status, headers, and original application-body chunk lengths.
 * @remarks
 * Headers are ordered name/value pairs restricted to content-type and content-encoding; their
 * encoded representation consumes the sidecar allowance. Chunks contains positive safe byte
 * lengths whose sum equals size. Body retains the bytes fetch exposed before text decoding,
 * so replay must not apply the original content encoding again.
 */
export interface StudyExchangeReply extends StudyExchangeBytes {
	readonly status: number
	readonly headers: ReadonlyArray<readonly [string, string]>
	readonly chunks: readonly number[]
}

/** Retains a fully consumed response only after status and terminal validation succeed. */
export interface StudyExchangeResponse extends StudyExchangeIdentity, StudyExchangeReply {
	readonly phase: 'response'
}

/** Retains an attempted exchange's failure and any bounded response bytes already observed.
 * @remarks
 * Response is absent before an HTTP reply arrives and may contain an incomplete body. Failure
 * preserves admitted charges and never invents completion, usage, or a successful terminal.
 */
export interface StudyExchangeFailure extends StudyExchangeIdentity {
	readonly phase: 'failure'
	readonly reason: string
	readonly response?: StudyExchangeReply
}

/** Closes a sidecar after the declared procedure and postflight have fully completed.
 * @remarks
 * Count equals the complete HTTP exchange population. This final row is forbidden after a
 * failed attempt, while a request or append is pending, or before all declared steps and both
 * verification passes finish. The strict reader joins it to evidence before sealing.
 */
export interface StudyExchangeCompletion {
	readonly phase: 'complete'
	readonly count: number
}

/** Names every admitted row of the bounded per-trial exchange sidecar. */
export type StudyExchangeRow =
	| StudyExchangeDeclaration
	| StudyExchangeAttempt
	| StudyExchangeResponse
	| StudyExchangeFailure
	| StudyExchangeCompletion

/** Holds a strictly verified successful request and response pair. */
export interface StudyRecordedExchange {
	readonly attempt: StudyExchangeAttempt
	readonly response: StudyExchangeResponse
}

/** Binds complete ordered exchanges to a verified sealed sidecar and its declaration.
 * @remarks
 * The strict reader verifies the seal and file digest, declared byte allowance, complete LF
 * rows, declaration and completion, every request/response byte digest and size, contiguous
 * order, stages, and the exact evidence-ordinal join before returning. Duplicate, orphaned,
 * reordered, partial, failed, or unsealed histories refuse with CUSTODY. File names the exact
 * member in the result seal; seal is that seal's id. An interface value alone is not proof of
 * provenance, so a replay constructor validates these invariants again before dependent work.
 */
export interface StudyExchangeHistory {
	readonly seal: string
	readonly file: StudyFile
	readonly declaration: StudyExchangeDeclaration
	readonly exchanges: readonly StudyRecordedExchange[]
	readonly completion: StudyExchangeCompletion
}

/** Owns serialized exchange appends under a reserved trial byte allowance.
 * @remarks
 * Reserves bounded terminal-failure space before admitting an attempt, accounts JSON framing and
 * base64 expansion before accepting bytes, and bounds pending append work through backpressure.
 * The first custody refusal remains latched and prevents completion even if the caller catches it.
 */
export interface StudyExchangeSinkInterface {
	/** Appends one validated row after reserving its complete serialized size.
	 * @param row - The next declaration, attempt, terminal, or completion in strict order.
	 * @returns Completion after the bytes are retained; a refusal stays latched.
	 */
	append(row: StudyExchangeRow): Promise<void>
	/** Closes admission and synchronizes all admitted writes without inventing completion.
	 * @returns Completion after the descriptor closes, including on interrupted histories.
	 */
	close(): Promise<void>
}

/** Supplies an exclusive sidecar descriptor and its parent-reserved byte allowance. */
export interface StudyExchangeSinkOptions {
	readonly file: FileHandle
	readonly record: StudyRecord
	/** Restores append state from a strictly verified prefix on the owned descriptor, without rewriting it. */
	readonly retained?: readonly StudyExchangeRow[]
}

/** Holds the exact byte identity of one execution file. */
export interface StudyFile {
	readonly path: string
	readonly bytes: number
	readonly digest: string
}

/** Holds a complete execution inventory and its deterministic identity. */
export interface StudySeal {
	readonly result: string
	readonly id: string
	readonly files: readonly StudyFile[]
}

/** Holds inspected execution metadata that is never gradeable before sealing. */
export interface StudyInterruptedResult {
	readonly status: 'interrupted'
	readonly directory: string
	readonly manifest: StudyManifest | undefined
	readonly attempts: readonly StudyAttempt[]
}

/** Holds independently verified sealed execution bytes. */
export interface StudySealedResult {
	readonly status: 'sealed'
	readonly directory: string
	readonly manifest: StudyManifest
	readonly attempts: readonly StudyAttempt[]
	readonly seal: StudySeal
}

/** Holds an offline execution reading discriminated by custody completeness. */
export type StudyResultReading = StudyInterruptedResult | StudySealedResult

/** Holds imported grading artifacts independently of execution. */
export interface StudyGradingStoreOptions {
	readonly result: StudySealedResult
	readonly rubric: Uint8Array
	readonly labels?: Uint8Array
	readonly packet?: StudyPacketBundle
}

/** Holds exact neutral public packet bytes and private mapping bytes. */
export interface StudyPacketBundle {
	readonly content: Uint8Array
	readonly mapping: Uint8Array
}

/** Holds one neutral semantic grading input without treatment or model identifiers. */
export interface StudyPacketEntry {
	readonly trial: string
	readonly criterion: string
	readonly input: JSONValue
	readonly product: StudyProduct | undefined
	readonly assertion: JSONValue
}

/** Holds the neutral identity mapping to a sealed semantic trial-criterion pair. */
export interface StudyPacketLink {
	readonly trial: string
	readonly criterion: string
	readonly source: {
		readonly trial: string
		readonly criterion: string
	}
}

/** Holds the evidence sink's shared admission budget. */
export interface StudyCustodyBudget {
	readonly reserve: (bytes: number) => void
}

/** Holds the trial sink's admitted writes and terminal lifecycle. */
export interface StudyTrialCustody {
	readonly sink: StudyCustodySinkInterface
	readonly terminal: Promise<void> | undefined
}

/** Closes evidence admission and drains already admitted appends. */
export interface StudyCustodySinkInterface extends StudySinkInterface {
	/** Closes admission immediately and synchronizes all previously admitted writes.
	 * @returns A promise that resolves after the evidence descriptor closes.
	 */
	close(): Promise<void>
}

/** Holds the owned evidence descriptor and byte admission constraints. */
export interface StudyEvidenceSinkOptions {
	readonly file: FileHandle
	readonly goals: readonly string[]
	readonly goal: number
	readonly trial: number
	readonly budget: StudyCustodyBudget
}

/** Names the execution custody lifecycle without inferring seal completeness. */
export type StudyCustodyPhase = 'new' | 'creating' | 'ready' | 'sealing' | 'sealed' | 'failed'
