import type {
	StudyContext,
	StudyLimit,
	StudyRole,
	StudyRoom,
	StudyTicket,
	StudyAgentDispatch,
} from '@src/core'
import type { JSONValue } from '@orkestrel/contract'
import type { TimeoutInterface } from '@orkestrel/timeout'
import type { OllamaOptions, OllamaTiming, extractTiming } from '@orkestrel/ollama'
import type {
	StudyExchangeHistory,
	StudyExchangeIdentity,
	StudyExchangeSinkInterface,
} from '../stores/types.js'

/**
 * Names the model roles an Ollama study transport dispatches under a declared policy.
 * @remarks
 * Inventory and metadata reads use the `metadata` role and need no policy.
 */
export type StudyOllamaRole = Extract<StudyRole, 'agent' | 'summary' | 'judge'>

/**
 * Declares one model role's exact wire policy.
 * @remarks
 * `model` names the served model the role dispatches to; the inventory must pin it. `options`
 * mirrors the Ollama `options` object the role must send exactly, and its `num_predict` member
 * is the role's output allowance. `think`: if `true`, a chat request may enable `think`; if
 * `false`, it must send `think: false`. `strict`: if `true`, a chat request must carry the Ollama
 * `truncate` and `shift` fields as `false`; if `false`, neither field is read. `length`: if
 * `true`, a `length` finish is the declared completion and generation may reach its allowance;
 * if `false`, either is a capacity refusal. The `judge` role dispatches the raw generate wire,
 * which carries no strict fields.
 */
export interface StudyOllamaPolicy {
	readonly model: string
	readonly options: Readonly<Record<string, number>>
	readonly think: boolean
	readonly strict: boolean
	readonly length: boolean
}

/**
 * Holds the Ollama provider options one role's declared policy determines.
 * @remarks
 * `truncate` and `shift` are present, and `false`, only when the policy is strict; the policy's
 * `length` allowance is transport-only and projects nothing.
 */
export type StudyOllamaOptions = Pick<
	OllamaOptions,
	'model' | 'think' | 'options' | 'truncate' | 'shift'
>

/** Pins one served model identity the inventory verifies. */
export interface StudyOllamaModel {
	readonly name: string
	readonly digest: string
}

/**
 * Sends one validated, admitted request under its Study role and returns the native response.
 * @remarks
 * Study owns response validation, cancellation, accounting, and the failure latch. The collaborator
 * receives the validated URL, encoded body, headers, bounded signal, and redirect policy;
 * it never settles a Study ticket.
 * @param role - The validated transport role, independent of the model name
 * @param input - The validated request URL
 * @param init - The owned request settings with the bounded signal and `redirect: 'error'`
 * @returns The native response Study reads and accounts
 */
export type StudyOllamaFetchFunction = (
	role: StudyRole,
	input: string | URL,
	init: RequestInit,
) => Promise<Response>

/** Bounds metadata calls, encoded bytes, and elapsed milliseconds outside model quotas.
 * @remarks
 * Each allowance is positive and finite; calls and bytes are safe integers. This budget covers
 * both verification passes across a trial and has no model-meter parent. The enclosing wall
 * deadline and sidecar custody budget still apply. No default is inferred from model limits.
 */
export interface StudyOllamaMetadata {
	readonly calls: number
	readonly bytes: number
	readonly duration: number
}

/** Names the ordered verification, model work, and daemon maintenance stages. */
export type StudyOllamaStage = 'preflight' | 'execution' | 'postflight' | 'maintenance'

/** Declares an ordered model request's goal, responsibility, route, and wire policy.
 * @remarks
 * Ordinal is a positive, contiguous, one-based position among declared model steps in a trial.
 * Metadata and maintenance have their own sidecar ordinals and consume no model-step position.
 * Path is /api/chat for agent or summary and /api/generate for judge. Goal must be a declared
 * member of the trial. Policy is checked before body collection and again before sending.
 */
export interface StudyOllamaStepIdentity {
	readonly ordinal: number
	readonly goal: string
	readonly role: StudyOllamaRole
	readonly path: '/api/chat' | '/api/generate'
	readonly policy: StudyOllamaPolicy
}

/** Declares an exact UTF-8 request body and its SHA-256 input receipt.
 * @remarks
 * Body is compared byte for byte, never as parsed JSON or by length alone. Input is a SHA-256
 * receipt of the encoded body, verified before execution rather than trusted in place of bytes.
 * Encoded length is derived from body, so an independent bytes declaration is forbidden.
 */
export interface StudyOllamaExactStep extends StudyOllamaStepIdentity {
	readonly admission: 'exact'
	readonly body: string
	readonly input: string
	readonly bytes?: never
}

/** Declares a captured request's positive safe byte length without predicting its content.
 * @remarks
 * Body and input are forbidden own members, including explicit undefined at runtime. Capture
 * proves declared identity, policy, and encoded length; it makes no content-fidelity claim.
 */
export interface StudyOllamaCaptureStep extends StudyOllamaStepIdentity {
	readonly admission: 'capture'
	readonly bytes: number
	readonly body?: never
	readonly input?: never
}

/** Separates exact request admission from length-declared capture admission. */
export type StudyOllamaStep = StudyOllamaExactStep | StudyOllamaCaptureStep

/** Selects a sealed recording and an explicit replay prefix for every scheduled trial.
 * @remarks
 * Result names a sealed result directory. Prefix maps each trial id to its positive safe count
 * of complete HTTP exchanges, including metadata and maintenance; each prefix ends at an
 * exchange boundary. Offline true requires the complete recorded population and forbids daemon
 * startup or a live sender. Offline false permits live continuation only after that prefix.
 * A changed request inside the prefix always refuses. Replay uses the executing profile's
 * bounds, never the recorded execution's elapsed-time allowance.
 */
export interface StudyOllamaReplaySelection {
	readonly result: string
	readonly prefix: Readonly<Record<string, number>>
	readonly offline: boolean
}

/** Configures exact recorded replies and optional live continuation after a declared prefix.
 * @remarks
 * History must come from the strict sealed sidecar reader and be checked completely before
 * construction, including declarations, byte digests, order, evidence joins, and completion.
 * Url pins the executing origin. Prefix counts complete HTTP exchanges, not JSONL rows. Limit
 * bounds replay work independently of recorded timing. Without fetch, the prefix must consume
 * the entire history and all later requests refuse; no native sender or daemon is created.
 * With fetch, only requests after the prefix are forwarded. A prefix mismatch never forwards.
 */
export interface StudyOllamaReplayOptions {
	readonly history: StudyExchangeHistory
	readonly url: string
	readonly prefix: number
	readonly limit: StudyOllamaMetadata
	readonly signal: AbortSignal
	readonly fetch?: StudyOllamaFetchFunction
}

/** Holds the executing request compared with the recorded cursor. */
export interface StudyOllamaReplayRequest {
	readonly ordinal: number
	readonly path: string
	readonly method: string
	readonly role: StudyRole
	readonly body: Uint8Array
}

/** Answers an exact recorded prefix through the role-aware transport collaborator. */
export interface StudyOllamaReplayInterface {
	/** Supplies native responses over retained bytes without settling a Study ticket. */
	readonly fetch: StudyOllamaFetchFunction
	/** Refuses a latched mismatch, an unread response, or an incompletely consumed prefix.
	 * @returns Nothing after the complete declared prefix has been consumed.
	 */
	check(): void
	/** Closes admission and cancels or drains owned response readers.
	 * @returns Completion after all replay resources are released.
	 */
	close(): Promise<void>
}

/**
 * Holds the Ollama study transport's immutable configuration.
 * @remarks
 * `url` is the admitted daemon origin. `room` supplies the context the transport reserves and the
 * safety margin it keeps. `limit` bounds each request's duration and encoded bytes. `models` pins
 * the served identities, keyed by the label their inventory evidence carries. `roles` declares the
 * wire policy of every model role the consumer dispatches; an undeclared role is refused.
 * `signal` cancels all work. `observe`: if `true`, existing evidence rows gain passive timing and
 * correlation fields; if `false`, passive fields are absent. Recording always retains exchange
 * ordinals and raw bytes independently of observation. `timing` extracts daemon timing; the selected Ollama runtime supplies the extractor and the transport imports none.
 * `fetch` optionally sends the validated request under its role. Default: native fetch. Study keeps
 * response validation and accounting; the collaborator returns a native response and settles no ticket.
 */
export interface StudyOllamaTransportOptions {
	readonly url: string
	readonly room: Pick<StudyRoom, 'context' | 'safety'>
	readonly limit: Pick<StudyLimit, 'duration' | 'bytes'>
	readonly models: Readonly<Record<string, StudyOllamaModel>>
	readonly roles: Readonly<Partial<Record<StudyOllamaRole, StudyOllamaPolicy>>> & {
		/** Forbids a model-generation policy for daemon maintenance. */
		readonly maintenance?: never
	}
	readonly signal: AbortSignal
	readonly observe: boolean
	readonly timing: typeof extractTiming
	readonly fetch?: StudyOllamaFetchFunction | undefined
	/** Bounds both metadata passes independently of every model quota. */
	readonly metadata: StudyOllamaMetadata
	/** Supplies the parent-composed declaration and retains exact bytes independently of observation. */
	readonly exchanges?: StudyExchangeSinkInterface
}

/**
 * Holds one outbound request's facts as owned at admission.
 * @remarks
 * `url` is the caller's URL spelling and `init` carries a copy of the caller's accepted settings
 * with owned headers; the caller's `signal` keeps its live identity. `dispatch` is a copy of the
 * caller's canonical dispatch. Later caller mutation changes none of them.
 */
export interface StudyOllamaSnapshot {
	readonly url: string
	readonly init: RequestInit | undefined
	readonly dispatch: StudyAgentDispatch | undefined
}

/** Holds one active goal's accounting and attribution. */
export interface StudyOllamaActivity {
	readonly goal: string
	readonly context: StudyContext
	/** Holds the public view retained with the goal's first observed dispatch; undefined omits that view and observed request bodies independently of exchange recording. */
	readonly checkpoint: JSONValue | undefined
}

/** Holds validated wire dispatch facts without retaining payload text. */
export interface StudyOllamaRequest {
	readonly role: StudyRole
	readonly path: string
	readonly model: string | undefined
	readonly output: number
	readonly bytes: number
	readonly options: Readonly<Record<string, number>>
	/** Reports whether the request's native `truncate` and `shift` fields were verified false. */
	readonly strict: boolean
	/** Reports whether the declared policy admits a `length` finish. */
	readonly length: boolean
}

/** Holds a validated terminal's finish reason and actual usage, unknown when unreported. */
export interface StudyOllamaTerminal {
	readonly prompt: number | undefined
	readonly completion: number | undefined
	readonly reason: string
}

/** Tracks one owned HTTP response until its end or cancellation. */
export interface StudyOllamaWire {
	/** Holds the recording deadline armed immediately before send, released at settlement. */
	readonly deadline?: TimeoutInterface | undefined
	/** Holds the admission registry key until this exchange settles. */
	readonly slot: symbol
	/** Holds the sidecar identity when recording is declared. */
	readonly identity: StudyExchangeIdentity | undefined
	/** Holds bounded reply headers in native iteration order. */
	readonly headers: ReadonlyArray<readonly [string, string]>
	/** Holds the combined request and response byte ceiling admitted for this exchange. */
	readonly ceiling: number
	readonly activity: StudyOllamaActivity
	readonly request: StudyOllamaRequest
	readonly ticket: StudyTicket
	readonly signal: AbortSignal
	readonly reader: ReadableStreamDefaultReader<Uint8Array>
	readonly decoder: InstanceType<typeof TextDecoder>
	/** Holds the HTTP status the daemon answered with. */
	readonly status: number
	readonly started: number
	/** Holds the trial-local request id. */
	readonly id: number
	/** Holds the monotonic millisecond reading taken immediately before native fetch. */
	readonly sent: number
	/** Holds the canonical dispatch this wire request was made for, when the caller measured one. */
	readonly dispatch: StudyAgentDispatch | undefined
	/** Holds the encoded request bytes plus every response byte counted so far. */
	readonly bytes: number
	/** Holds the decoded response text not yet consumed as complete rows. */
	readonly text: string
	readonly terminal: StudyOllamaTerminal | undefined
	/** Holds the daemon timing of the terminal row once observed. */
	readonly timing: OllamaTiming | undefined
	/** Reports whether the request was accounted, finished or failed. */
	readonly settled: boolean
}
