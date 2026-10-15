import type { JSONValue } from '@orkestrel/contract'
import type { OllamaTiming, extractTiming } from '@orkestrel/ollama'
import type {
	StudyContext,
	StudyLimit,
	StudyRole,
	StudyRoom,
	StudyTicket,
} from '../../core/types.js'
import type { StudyAgentDispatch } from '../../core/agents/types.js'

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

/** Pins one served model identity the inventory verifies. */
export interface StudyOllamaModel {
	readonly name: string
	readonly digest: string
}

/**
 * Holds the Ollama study transport's immutable configuration.
 * @remarks
 * `url` is the admitted daemon origin. `room` supplies the context the transport reserves and the
 * safety margin it keeps. `limit` bounds each request's duration and encoded bytes. `models` pins
 * the served identities, keyed by the label their inventory evidence carries. `roles` declares the
 * wire policy of every model role the consumer dispatches; an undeclared role is refused.
 * `signal` cancels all work. `observe`: if `true`, existing evidence rows gain passive timing and
 * correlation fields; if `false`, they carry none. `timing` extracts daemon timing; the selected Ollama runtime supplies the extractor and the transport imports none.
 */
export interface StudyOllamaTransportOptions {
	readonly url: string
	readonly room: Pick<StudyRoom, 'context' | 'safety'>
	readonly limit: Pick<StudyLimit, 'duration' | 'bytes'>
	readonly models: Readonly<Record<string, StudyOllamaModel>>
	readonly roles: Readonly<Partial<Record<StudyOllamaRole, StudyOllamaPolicy>>>
	readonly signal: AbortSignal
	readonly observe: boolean
	readonly timing: typeof extractTiming
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
	/** Holds the owned public view retained with the goal's first model dispatch; undefined retains neither it nor request bodies. */
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
	readonly activity: StudyOllamaActivity
	readonly request: StudyOllamaRequest
	readonly ticket: StudyTicket
	readonly signal: AbortSignal
	readonly reader: ReadableStreamDefaultReader<Uint8Array>
	readonly decoder: TextDecoder
	/** Holds the HTTP status the daemon answered with. */
	readonly status: number
	readonly started: number
	/** Holds the trial-local request id. */
	readonly id: number
	/** Holds the monotonic millisecond reading taken immediately before native fetch. */
	readonly sent: number
	/** Holds the canonical dispatch this wire request was made for, when the caller measured one. */
	readonly dispatch: StudyAgentDispatch | undefined
	bytes: number
	text: string
	terminal: StudyOllamaTerminal | undefined
	/** Holds the daemon timing of the terminal row once observed. */
	timing: OllamaTiming | undefined
	settled: boolean
}
