import type { StudyRole, StudyTicket, StudyAgentDispatch, StudyLatchInterface } from '@src/core'
import type { BudgetError } from '@orkestrel/budget'
import type { JSONValue } from '@orkestrel/contract'
import type { OllamaTiming } from '@orkestrel/ollama'
import type { ReadableStreamReadResult } from 'node:stream/web'
import type {
	StudyOllamaActivity,
	StudyOllamaFetchFunction,
	StudyOllamaRequest,
	StudyOllamaSnapshot,
	StudyOllamaTerminal,
	StudyOllamaTransportOptions,
} from './types.js'
import type { StudyExchangeIdentity, StudyExchangeDeclaration } from '../stores/types.js'
import {
	StudyError,
	isStudyError,
	StudyControl,
	StudyScope,
	StudyMeter,
	readStudyFailure,
	buildStudyAgentDispatch,
	studyStopToJSON,
} from '@src/core'
import { Abort } from '@orkestrel/abort'
import { isBudgetError } from '@orkestrel/budget'
import { isFunction, isRecord, parseJSON } from '@orkestrel/contract'
import { MAX_TIMEOUT_MS, Timeout } from '@orkestrel/timeout'
import { buildStudyOllamaSnapshot, buildStudyOllamaTransportOptions } from './cloners.js'
import { StudyOllamaExchange } from './StudyOllamaExchange.js'
import { StudyOllamaGoal } from './StudyOllamaGoal.js'
import {
	buildStudyOllamaRaw,
	buildStudyOllamaTiming,
	readStudyOllamaDigest,
	readStudyOllamaFailure,
	readStudyOllamaRequest,
	readStudyOllamaSupport,
	readStudyOllamaTerminal,
	readStudyOllamaTiming,
	validateStudyOllamaCompletion,
	validateStudyOllamaInventory,
	validateStudyOllamaRoles,
	validateStudyOllamaRecording,
	validateStudyOllamaStep,
	buildStudyOllamaBytes,
} from './helpers.js'

/** Admits and accounts Ollama wire requests under declared policies and latches failure. */
export class StudyOllamaTransport implements StudyLatchInterface {
	readonly #options: StudyOllamaTransportOptions
	readonly #declaration: StudyExchangeDeclaration | undefined
	#executions: ReadonlyArray<{ readonly goal: string; readonly duration: number }> = []
	readonly #abort = new AbortController()
	readonly #sends = new Set<Promise<StudyOllamaExchange>>()
	readonly #wires = new Set<StudyOllamaExchange>()
	readonly #finalizations = new WeakMap<StudyOllamaExchange, Promise<void>>()
	readonly #drains = new Set<Promise<void>>()
	#closing: Promise<void> | undefined
	#drainFailure: { readonly error: unknown } | undefined
	readonly #requests = new Set<symbol>()
	readonly #verifications = new Set<symbol>()
	readonly #metadataControl: StudyControl
	readonly #metadataScope: StudyScope
	readonly #metadataMeter: StudyMeter
	#passes = 0
	// The bound goal; `prepare` binds it and `clear` or `close` releases it. An admitted request keeps the goal it was admitted under.
	#goal: StudyOllamaGoal | undefined
	// Wraps the first retained failure so a thrown undefined or null is still a presence.
	#fault: { readonly error: unknown } | undefined
	#count = 0
	// The model of the preceding model dispatch; it spans goals, so the next goal's first dispatch reports a switch.
	#previous: string | undefined

	/** Records immutable transport bounds and refuses a role policy the inventory cannot serve.
	 * @param options - Origin, room, request limit, pinned inventory, role policies, and cancellation.
	 */
	constructor(options: StudyOllamaTransportOptions) {
		const owned = buildStudyOllamaTransportOptions(options)
		if (owned.fetch !== undefined && !isFunction(owned.fetch))
			throw new StudyError('CONFIG', 'Ollama fetch collaborator must be callable')
		validateStudyOllamaRoles(owned.roles, owned.models)
		this.#declaration = structuredClone(validateStudyOllamaRecording(owned))
		this.#options = owned
		this.#metadataControl = new StudyControl(owned.signal)
		const duration = Math.min(MAX_TIMEOUT_MS, Math.ceil(owned.metadata.duration))
		this.#metadataScope = new StudyScope({
			limit: { ...owned.metadata, duration: MAX_TIMEOUT_MS, tokens: 1 },
			control: this.#metadataControl,
			label: 'Metadata',
		})
		this.#metadataMeter = new StudyMeter({
			request: {
				duration: Math.min(duration, owned.limit.duration),
				calls: 1,
				tokens: 1,
				bytes: owned.metadata.bytes,
			},
			scopes: [this.#metadataScope],
			control: this.#metadataControl,
		})
	}

	/** Binds subsequent wire requests to one live goal until `clear` or `close` ends it.
	 * @param activity - The goal's accounting boundary.
	 * @throws StudyError - Thrown with code `FAULT` when a model response is still open or a goal is still bound; the bound goal stays bound.
	 * @throws unknown - Thrown with the retained failure or the cancellation reason, as `check` throws it.
	 */
	prepare(activity: StudyOllamaActivity): void {
		this.check()
		if (this.#wires.size !== 0)
			throw new StudyError('FAULT', 'Previous model response is still open')
		if (this.#goal !== undefined) throw new StudyError('FAULT', 'Previous goal is still bound')
		this.#goal = new StudyOllamaGoal(activity)
	}

	/** Ends the bound goal so another goal can be prepared; a request already admitted keeps its own goal.
	 * @returns Nothing; a transport with no bound goal stays unbound, and a closed transport stays closed.
	 */
	clear(): void {
		this.#goal = undefined
	}

	/** Refuses work after any retained failure or cancellation.
	 * @returns Nothing when work may continue.
	 */
	check(): void {
		if (this.#fault !== undefined) throw this.#fault.error
		this.#options.signal.throwIfAborted()
		this.#abort.signal.throwIfAborted()
	}

	/** Retains an operational failure even when an inner runtime catches it.
	 * @param error - The observed failure; the first retained failure keeps its identity, and a branded `BudgetError` retains nothing because Agent reports that stop in its own result.
	 */
	fail(error: unknown): void {
		// An Agent budget's cut is reported by Agent's own result, so nothing is retained to re-raise.
		if (!isBudgetError(error)) this.#fault ??= { error }
	}

	/** Checks every pinned serving identity through admitted inventory and metadata requests.
	 * @returns Completion after inventory validation and support evidence.
	 * @throws StudyError - Thrown with code `FAULT` when no goal is bound; the transport retains this refusal as its failure, as it retains every verification failure.
	 */
	async verify(): Promise<void> {
		const verification = Symbol('verification')
		try {
			this.check()
			if (this.#requests.size !== 0 || this.#verifications.size !== 0)
				throw new StudyError('FAULT', 'Verification cannot overlap an admitted request')
			if (this.#goal === undefined)
				throw new StudyError('FAULT', 'Model dispatch outside an active goal')
			const declaration = this.#declaration
			if (declaration !== undefined && this.#passes === 1 && this.#modelRemaining < 0)
				throw this.#durationFailure(undefined)
			if (
				declaration !== undefined &&
				(this.#passes > 1 ||
					this.#goal.activity.goal !==
						(this.#passes === 0 ? declaration.goals[0] : declaration.goals.at(-1)) ||
					(this.#passes === 1 &&
						declaration.procedure !== undefined &&
						this.#executions.length !== declaration.procedure.length))
			)
				throw new StudyError('FAULT', 'Postflight requires the complete model procedure')
			this.#verifications.add(verification)
			if (declaration !== undefined) {
				const version = await this.fetch('metadata', new URL('/api/version', this.#options.url), {
					method: 'GET',
				})
				await version.text()
			}
			const response = await this.fetch('metadata', new URL('/api/tags', this.#options.url), {
				method: 'GET',
			})
			const value: unknown = await response.json()
			validateStudyOllamaInventory(value, this.#options.models)
			const goal = this.#goal
			if (goal === undefined) throw new StudyError('FAULT', 'Inventory has no goal attribution')
			const activity = goal.activity
			const models = Object.values(this.#options.models)
			for (const model of new Set(models.map((entry) => entry.name))) {
				const support = await this.fetch('metadata', new URL('/api/show', this.#options.url), {
					method: 'POST',
					body: JSON.stringify({ model }),
					headers: { 'content-type': 'application/json' },
				})
				const metadata: unknown = await support.json()
				const ceiling = readStudyOllamaSupport(metadata, this.#options.room.context)
				await activity.context.evidence.append({
					event: 'support',
					goal: activity.goal,
					value: { model, ceiling, requested: this.#options.room.context },
				})
			}
			await activity.context.evidence.append({
				event: 'inventory',
				goal: activity.goal,
				value: Object.fromEntries(
					Object.entries(this.#options.models).map(([label, model]) => [label, model.digest]),
				),
			})
			this.check()
			this.#passes += 1
			if (this.#options.exchanges !== undefined && this.#passes === 2) {
				if (this.#requests.size !== 0 || this.#sends.size !== 0 || this.#wires.size !== 0)
					throw new StudyError('FAULT', 'Cannot complete while an exchange is pending')
				await this.#options.exchanges.append({
					phase: 'complete',
					count: this.#options.exchanges.next - 1,
				})
			}
		} catch (error) {
			this.fail(error)
			throw error
		} finally {
			this.#verifications.delete(verification)
		}
	}

	/** Dispatches exactly one admitted request with bounded streaming reads.
	 * @param role - The accountable responsibility.
	 * @param input - The exact configured URL.
	 * @param init - The native fetch settings.
	 * @param original - The immutable canonical dispatch the caller measured for this request; it joins the observation rows and never changes the request.
	 * @returns A validated streaming response.
	 * @throws StudyError - Thrown with code `FAULT` when no goal is bound, before admission and without retaining a failure.
	 * @throws StudyError - Thrown with the recognized provider failure or a role-attributed `FAULT` for a non-2xx response, after its bounded body was read and its request accounted once.
	 */
	async fetch(
		role: StudyRole,
		input: string | URL | Request,
		init?: RequestInit,
		original?: StudyAgentDispatch,
	): Promise<Response> {
		this.check()
		const goal = this.#goal
		if (goal === undefined) throw new StudyError('FAULT', 'Model dispatch outside an active goal')
		const activity = goal.activity
		const slot = Symbol('request')
		try {
			if (this.#requests.size !== 0)
				throw new StudyError('FAULT', 'A previous Ollama request is still in flight')
			if (this.#verifications.size !== 0 && role !== 'metadata')
				throw new StudyError('FAULT', 'Model dispatch cannot overlap verification')
			this.#requests.add(slot)
			// Everything the request depends on is owned before the first await; the caller's originals are never read again.
			const snapshot = buildStudyOllamaSnapshot(input, init, original)
			const settings = snapshot.init
			const request = readStudyOllamaRequest(this.#options, role, snapshot.url, settings)
			const declaration = this.#declaration
			if (declaration !== undefined && role !== 'metadata') {
				if (this.#passes !== 1)
					throw new StudyError(
						'FAULT',
						'Model dispatch requires completed preflight and open execution',
					)
				const index = declaration.goals.indexOf(activity.goal)
				const previous = this.#executions.at(-1)
				if (
					index < 0 ||
					(previous !== undefined && index < declaration.goals.indexOf(previous.goal))
				)
					throw new StudyError('FAULT', 'Model goal is outside or behind the recording horizon')
				if (this.#executions.length >= declaration.record.calls)
					throw new StudyError('CAPACITY', 'Recording calls allowance exhausted', {
						cause: 'capacity',
						message: 'Recording calls allowance exhausted',
						role,
						stop: {
							layer: 'scope',
							id: 'Recording calls',
							max: declaration.record.calls,
							consumed: this.#executions.length + 1,
						},
					})
				if (this.#modelRemaining <= 0) throw this.#durationFailure(role)
				if (declaration.procedure !== undefined)
					validateStudyOllamaStep(
						declaration.procedure[this.#executions.length],
						activity.goal,
						request,
						settings?.body,
					)
			}
			if (
				this.#options.exchanges !== undefined &&
				role === 'metadata' &&
				this.#verifications.size === 0
			)
				throw new StudyError('FAULT', 'Recorded metadata requires a verification pass')
			return await this.#request(slot, role, goal, request, snapshot)
		} catch (error) {
			this.#requests.delete(slot)
			this.fail(error)
			throw error
		}
	}

	/** Cancels every outstanding native reader and permanently closes the transport.
	 * @returns Shared completion after response finalization and native cancellation.
	 * @throws Thrown when finalization cannot retain its terminal or evidence, or release its reader.
	 */
	close(): Promise<void> {
		this.#closing ??= Promise.resolve().then(() => this.#close())
		this.#abort.abort(new StudyError('FAULT', 'Ollama transport closed'))
		return this.#closing
	}

	async #close(): Promise<void> {
		await Promise.all(
			[...this.#sends].map((sending) => sending.catch((error: unknown) => this.fail(error))),
		)
		await Promise.allSettled(
			[...this.#wires].map((wire) => this.#failWire(wire, this.#abort.signal.reason)),
		)
		// A pull owns its terminal append even after accounting releases the wire.
		await Promise.allSettled(this.#drains)
		this.#goal = undefined
		this.#metadataMeter.close()
		this.#metadataScope.close()
		this.#metadataControl.close()
		if (this.#drainFailure !== undefined) throw this.#drainFailure.error
	}

	#track(work: Promise<void>): Promise<void> {
		this.#drains.add(work)
		void work.then(
			() => this.#drains.delete(work),
			(error: unknown) => {
				this.#drainFailure ??= { error }
				this.#drains.delete(work)
			},
		)
		return work
	}

	#finalize(wire: StudyOllamaExchange, work: () => Promise<void>): Promise<void> {
		const existing = this.#finalizations.get(wire)
		if (existing !== undefined) return existing
		// Publish ownership before ticket settlement can synchronously abort another pull.
		const pending = Promise.resolve().then(work)
		this.#finalizations.set(wire, pending)
		return this.#track(pending)
	}

	async #request(
		slot: symbol,
		role: StudyRole,
		goal: StudyOllamaGoal,
		request: StudyOllamaRequest,
		snapshot: StudyOllamaSnapshot,
	): Promise<Response> {
		const activity = goal.activity
		const settings = snapshot.init
		const metadata = role === 'metadata'
		const available =
			this.#options.metadata.bytes -
			this.#metadataMeter.usage.reduce(
				(total, usage) => total + (usage.bytes ?? this.#options.metadata.bytes),
				0,
			)
		const remaining = this.#remaining
		if (metadata && remaining <= 0)
			throw new StudyError('DEADLINE', 'Metadata duration allowance exhausted', {
				cause: 'deadline',
				message: 'Metadata duration allowance exhausted',
				role,
				stop: {
					layer: 'scope',
					id: 'Metadata duration',
					max: this.#options.metadata.duration,
					consumed: this.#options.metadata.duration - remaining,
				},
			})
		const limit = {
			duration: metadata
				? Math.min(this.#options.limit.duration, Math.ceil(remaining))
				: this.#options.limit.duration,
			bytes: metadata ? Math.min(this.#options.limit.bytes, available) : this.#options.limit.bytes,
		}
		if (request.bytes >= limit.bytes) {
			const message = 'Encoded request consumes the response byte allowance'
			throw new StudyError('CAPACITY', message, {
				cause: 'capacity',
				message,
				role,
				stop: { layer: 'scope', id: 'Wire bytes', max: limit.bytes, consumed: request.bytes },
			})
		}
		const ticket = await (metadata ? this.#metadataMeter : activity.context.meter).admit({
			role,
			tokens: role === 'metadata' ? 0 : this.#options.room.context - this.#options.room.safety,
			bytes: limit.bytes,
		})
		const id = this.#options.exchanges?.next ?? ++this.#count
		const started = performance.now()
		const signal = AbortSignal.any([
			this.#options.signal,
			this.#abort.signal,
			activity.context.signal,
			...(metadata ? [this.#metadataMeter.signal] : [activity.context.meter.signal]),
			ticket.signal,
			AbortSignal.timeout(limit.duration),
			...(settings?.signal === undefined || settings.signal === null ? [] : [settings.signal]),
		])
		const identity: StudyExchangeIdentity | undefined =
			this.#options.exchanges === undefined
				? undefined
				: {
						ordinal: id,
						goal: activity.goal,
						role,
						path:
							role === 'metadata'
								? request.path === '/api/version'
									? '/api/version'
									: request.path === '/api/tags'
										? '/api/tags'
										: '/api/show'
								: role === 'judge'
									? '/api/generate'
									: '/api/chat',
						method: settings?.method === 'GET' ? 'GET' : 'POST',
						stage:
							role === 'metadata' ? (this.#passes === 0 ? 'preflight' : 'postflight') : 'execution',
						...(role === 'metadata' ? {} : { step: this.#executions.length + 1 }),
					}
		const sending = this.#send(
			role,
			goal,
			ticket,
			request,
			snapshot,
			signal,
			id,
			started,
			slot,
			identity,
			limit.bytes,
		)
		this.#sends.add(sending)
		const wire = await sending.finally(() => this.#sends.delete(sending))
		if (wire.status < 200 || wire.status > 299) return await this.#refuse(wire)
		return new Response(
			new ReadableStream<Uint8Array>({
				pull: (controller) => this.#pull(wire, controller),
				cancel: (reason: unknown) => this.#cancelResponse(wire, reason),
			}),
			{
				status: wire.status,
				headers: {
					'content-type':
						role === 'judge' || role === 'metadata' ? 'application/json' : 'application/x-ndjson',
				},
			},
		)
	}

	get #remaining(): number {
		return (
			this.#options.metadata.duration -
			this.#metadataMeter.usage.reduce((total, usage) => total + usage.duration, 0)
		)
	}

	get #modelRemaining(): number {
		return (
			(this.#declaration?.record.duration ?? Infinity) -
			this.#executions.reduce((total, execution) => total + execution.duration, 0)
		)
	}

	#durationFailure(role: StudyRole | undefined): StudyError {
		return new StudyError('DEADLINE', 'Recording duration allowance exhausted', {
			cause: 'deadline',
			message: 'Recording duration allowance exhausted',
			role,
			stop: {
				layer: 'scope',
				id: 'Recording duration',
				max: this.#declaration?.record.duration,
				consumed: (this.#declaration?.record.duration ?? 0) - Math.min(0, this.#modelRemaining),
			},
		})
	}

	// Buffers a non-2xx body under the wire bounds and parses it once at its end, because an error body is one JSON document, not rows.
	async #refuse(wire: StudyOllamaExchange): Promise<never> {
		const failure = await this.#diagnose(wire)
		await this.#failWire(wire, failure)
		throw failure
	}

	// Reads the refusal body to its end and returns the failure it names, or the error that stopped the read.
	async #diagnose(wire: StudyOllamaExchange): Promise<unknown> {
		// A lenient decoder: undecodable bytes make the body invalid JSON, which is a generic refusal rather than a decode crash.
		const decoder = new TextDecoder()
		const parts: string[] = []
		try {
			for (;;) {
				wire.signal.throwIfAborted()
				const chunk = await this.#read(wire)
				wire.signal.throwIfAborted()
				if (chunk.done) break
				wire.count(chunk.value.byteLength, wire.ceiling)
				wire.retain(chunk.value)
				parts.push(decoder.decode(chunk.value, { stream: true }))
			}
			const body: unknown = parseJSON(parts.join('') + decoder.decode())
			const message = `Ollama HTTP response refused: ${wire.status}`
			return (
				readStudyOllamaFailure(body, wire.request.role, wire.status) ??
				new StudyError('FAULT', message, {
					cause: 'infrastructure',
					message,
					role: wire.request.role,
					stop: undefined,
				})
			)
		} catch (error) {
			return error
		}
	}

	#pull(
		wire: StudyOllamaExchange,
		controller: ReadableStreamDefaultController<Uint8Array>,
	): Promise<void> {
		return this.#track(this.#readResponse(wire, controller))
	}

	async #readResponse(
		wire: StudyOllamaExchange,
		controller: ReadableStreamDefaultController<Uint8Array>,
	): Promise<void> {
		try {
			wire.signal.throwIfAborted()
			const chunk = await this.#read(wire)
			wire.cancellation.throwIfAborted()
			wire.signal.throwIfAborted()
			if (!chunk.done) {
				wire.count(chunk.value.byteLength, wire.ceiling)
				wire.retain(chunk.value)
				wire.decode(chunk.value)
				if (wire.request.role !== 'metadata' && wire.request.role !== 'judge')
					this.#rows(wire, false)
				controller.enqueue(chunk.value)
				return
			}
			await this.#finalize(wire, () => this.#completeResponse(wire, controller))
		} catch (error) {
			this.fail(error)
			try {
				if (isBudgetError(error)) await this.#cut(wire, error)
				else await this.#failWire(wire, error)
			} finally {
				this.#requests.delete(wire.slot)
				controller.error(error)
			}
		}
	}

	async #completeResponse(
		wire: StudyOllamaExchange,
		controller: ReadableStreamDefaultController<Uint8Array>,
	): Promise<void> {
		try {
			wire.flush()
			if (wire.request.role === 'metadata') {
				const value: unknown = JSON.parse(wire.text)
				if (wire.request.path === '/api/tags')
					validateStudyOllamaInventory(value, this.#options.models)
				else if (wire.request.path === '/api/version') {
					if (!isRecord(value) || value.version !== this.#declaration?.version)
						throw new StudyError('FAULT', 'Serving version differs from the declared version')
				} else readStudyOllamaSupport(value, this.#options.room.context)
			} else if (wire.request.role === 'judge') {
				this.#observe(wire, JSON.parse(wire.text))
			} else this.#rows(wire, true)
			if (wire.request.role !== 'metadata' && wire.terminal === undefined)
				throw new StudyError('FAULT', 'Ollama response has no terminal row')
			await this.#finish(wire)
			wire.cancellation.throwIfAborted()
			wire.signal.throwIfAborted()
			if (wire.request.role === 'metadata' && this.#remaining < 0) {
				const message = 'Metadata duration allowance exhausted'
				throw new StudyError('DEADLINE', message, {
					cause: 'deadline',
					message,
					role: 'metadata',
					stop: {
						layer: 'scope',
						id: 'Metadata duration',
						max: this.#options.metadata.duration,
						consumed: this.#options.metadata.duration - this.#remaining,
					},
				})
			}
			if (wire.terminal !== undefined) await this.#judge(wire, wire.terminal)
			// Admission below commits the terminal synchronously; cancellation after it only joins retention.
			wire.cancellation.throwIfAborted()
			if (wire.identity !== undefined) {
				this.check()
				await this.#options.exchanges?.append({
					phase: 'response',
					...wire.identity,
					...wire.reply,
				})
				wire.record()
			}
			this.#requests.delete(wire.slot)
			if (!wire.cancellation.aborted) controller.close()
		} catch (error) {
			this.fail(error)
			try {
				// This path already owns finalization; joining it here would await itself.
				if (isBudgetError(error)) await this.#cutResponse(wire, error)
				else await this.#failResponse(wire, error)
			} finally {
				this.#requests.delete(wire.slot)
				controller.error(error)
			}
		}
	}

	#cancelResponse(wire: StudyOllamaExchange, reason: unknown): Promise<void> {
		// Only undefined denotes absence; null and every other thrown value keep their identity.
		const error =
			reason === undefined
				? new StudyError('FAULT', 'Ollama response cancelled before its end')
				: reason
		wire.cancel(error)
		return isBudgetError(error) ? this.#cut(wire, error) : this.#failWire(wire, error)
	}

	// Checks the terminal against the wire's declared policy; a refusal that names a stop is retained as one `stop` row before it propagates.
	async #judge(wire: StudyOllamaExchange, terminal: StudyOllamaTerminal): Promise<void> {
		try {
			validateStudyOllamaCompletion(terminal, this.#options.room, wire.request)
		} catch (error) {
			const stop = readStudyFailure(error).stop
			if (stop !== undefined)
				await wire.activity.context.evidence.append({
					event: 'stop',
					goal: wire.activity.goal,
					value: {
						role: wire.request.role,
						path: wire.request.path,
						finish: terminal.reason,
						prompt: terminal.prompt ?? null,
						completion: terminal.completion ?? null,
						stop: studyStopToJSON(stop),
						...(this.#options.observe ? this.#timeline(wire) : {}),
					},
				})
			throw error
		}
	}

	// Consumes the complete rows of the wire's text; each row after the terminal is refused.
	#rows(wire: StudyOllamaExchange, final: boolean): void {
		for (const line of wire.take(final)) {
			if (line.trim() === '') continue
			if (wire.terminal !== undefined)
				throw new StudyError('FAULT', 'Ollama emitted a row after its terminal')
			this.#observe(wire, JSON.parse(line))
		}
	}

	// Validates a row against the wire's request and retains it; the timing extractor runs only on a terminal row.
	#observe(wire: StudyOllamaExchange, row: unknown): void {
		const terminal = readStudyOllamaTerminal(row, wire.request)
		wire.observe(terminal, terminal === undefined ? undefined : this.#time(row))
	}

	// Reads the daemon timing of a terminal row when timing is observed.
	#time(row: unknown): OllamaTiming | undefined {
		return this.#options.observe && isRecord(row)
			? readStudyOllamaTiming(this.#options.timing, row)
			: undefined
	}

	// Dispatches one admitted request and owns the wire it opens; a failure before the wire exists fails the request's ticket here.
	async #send(
		role: StudyRole,
		goal: StudyOllamaGoal,
		ticket: StudyTicket,
		request: StudyOllamaRequest,
		snapshot: StudyOllamaSnapshot,
		signal: AbortSignal,
		id: number,
		started: number,
		slot: symbol,
		identity: StudyExchangeIdentity | undefined,
		ceiling: number,
	): Promise<StudyOllamaExchange> {
		const { url, init: settings, dispatch } = snapshot
		const remaining = this.#modelRemaining
		const deadline =
			role !== 'metadata' && remaining <= this.#options.limit.duration
				? new Timeout({ ms: Math.min(MAX_TIMEOUT_MS, Math.max(0, Math.ceil(remaining))), signal })
				: undefined
		const recording = new AbortController()
		const bounded = AbortSignal.any([signal, recording.signal])
		deadline?.signal.addEventListener('abort', () => recording.abort(this.#durationFailure(role)), {
			once: true,
			signal,
		})
		try {
			this.check()
			signal.throwIfAborted()
			if (identity !== undefined)
				await this.#options.exchanges?.append({
					phase: 'attempt',
					...identity,
					...buildStudyOllamaBytes(
						new TextEncoder().encode(typeof settings?.body === 'string' ? settings.body : ''),
					),
				})
			await goal.activity.context.evidence.append({
				event: 'dispatch',
				goal: goal.activity.goal,
				value: {
					role,
					path: request.path,
					model: request.model ?? null,
					options: { ...request.options },
					bytes: request.bytes,
					...(identity === undefined ? {} : { ordinal: identity.ordinal }),
					...(this.#options.observe ? this.#dispatch(goal, request, id, settings, dispatch) : {}),
				},
			})
			signal.throwIfAborted()
			this.check()
			const sent = performance.now()
			deadline?.start()
			const response =
				this.#options.fetch === undefined
					? await globalThis.fetch(url, { ...settings, signal: bounded, redirect: 'error' })
					: await this.#fetch(this.#options.fetch, role, url, settings, bounded)
			if (bounded.aborted) {
				void response.body?.cancel(bounded.reason).catch(() => undefined)
				bounded.throwIfAborted()
			}
			if (response.body === null)
				throw new StudyError('FAULT', `Ollama HTTP response refused: ${response.status}`)
			const wire = new StudyOllamaExchange({
				slot,
				identity,
				ceiling,
				headers: [...response.headers.entries()].filter(
					([name]) => name === 'content-type' || name === 'content-encoding',
				),
				activity: goal.activity,
				request,
				ticket,
				signal: bounded,
				deadline,
				reader: response.body.getReader(),
				decoder: new TextDecoder('utf-8', { fatal: true }),
				status: response.status,
				started,
				id,
				sent,
				dispatch,
				bytes: request.bytes,
			})
			this.#wires.add(wire)
			return wire
		} catch (error) {
			deadline?.clear()
			try {
				if (
					identity !== undefined &&
					this.#options.exchanges !== undefined &&
					this.#options.exchanges.next > identity.ordinal
				) {
					this.#fault ??= { error }
					await this.#options.exchanges.append({
						phase: 'failure',
						...identity,
						reason: readStudyFailure(error).message.slice(0, 256),
					})
				}
			} finally {
				if (!ticket.settled && !ticket.signal.aborted) {
					// Agent reports its budget cut; the admitted request still keeps unknown cost.
					if (isBudgetError(error))
						ticket.finish({
							role,
							calls: 1,
							tokens: undefined,
							bytes: undefined,
							duration: Math.ceil(performance.now() - started),
						})
					else ticket.fail({ ...readStudyFailure(error), role })
				}
			}
			throw error
		}
	}

	#read(wire: StudyOllamaExchange): Promise<ReadableStreamReadResult<Uint8Array>> {
		const listeners = new Abort()
		return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
			wire.signal.addEventListener('abort', () => reject(wire.signal.reason), {
				once: true,
				signal: listeners.signal,
			})
			wire.signal.throwIfAborted()
			wire.reader.read().then(resolve, reject)
		}).finally(() => listeners.abort())
	}

	async #recordFailure(wire: StudyOllamaExchange, error: unknown): Promise<void> {
		if (wire.identity === undefined || wire.recorded) return
		this.#fault ??= { error }
		const reason = readStudyFailure(error).message
		try {
			await this.#options.exchanges?.append({
				phase: 'failure',
				...wire.identity,
				reason: reason.slice(0, 256),
				response: wire.reply,
			})
		} catch (failure) {
			if (!isStudyError(failure) || failure.code !== 'CAPACITY') throw failure
			await this.#options.exchanges?.append({
				phase: 'failure',
				...wire.identity,
				reason: `The reply was not retained because it exceeded the sidecar allowance; ${reason.slice(0, 128)}`,
			})
		}
		wire.record()
	}

	// Bounds the collaborator independently of its cooperation and releases a response that arrives after cancellation.
	#fetch(
		fetch: StudyOllamaFetchFunction,
		role: StudyRole,
		url: string,
		settings: RequestInit | undefined,
		signal: AbortSignal,
	): Promise<Response> {
		const listeners = new Abort()
		return new Promise<Response>((resolve, reject) => {
			signal.addEventListener('abort', () => reject(signal.reason), {
				once: true,
				signal: listeners.signal,
			})
			signal.throwIfAborted()
			fetch(role, url, { ...settings, signal, redirect: 'error' }).then((response) => {
				if (signal.aborted) {
					void response.body?.cancel(signal.reason).catch(() => undefined)
					reject(signal.reason)
				} else resolve(response)
			}, reject)
		}).finally(() => listeners.abort())
	}

	#dispatch(
		goal: StudyOllamaGoal,
		request: StudyOllamaRequest,
		id: number,
		init: RequestInit | undefined,
		dispatch: StudyAgentDispatch | undefined,
	): Readonly<Record<string, JSONValue>> {
		const previous = this.#previous
		const model = request.role !== 'metadata'
		if (model) this.#previous = request.model
		const checkpoint = goal.activity.checkpoint
		const snapshot = goal.attach()
		const raw = buildStudyOllamaRaw(init?.body)
		return {
			id,
			...buildStudyAgentDispatch(dispatch),
			...(raw === undefined ? {} : { raw }),
			digest: readStudyOllamaDigest(this.#options.models, request) ?? null,
			previous: previous ?? null,
			changed: model && previous !== undefined && previous !== request.model,
			...(request.strict ? { strict: true } : {}),
			...(checkpoint === undefined
				? {}
				: { body: typeof init?.body === 'string' ? init.body : null }),
			...(snapshot === undefined ? {} : { snapshot }),
		}
	}

	#timeline(wire: StudyOllamaExchange): Readonly<Record<string, JSONValue>> {
		return {
			id: wire.id,
			...buildStudyAgentDispatch(wire.dispatch),
			started: wire.started,
			sent: wire.sent,
			elapsed: performance.now() - wire.sent,
		}
	}

	#settle(wire: StudyOllamaExchange): void {
		wire.settle()
		if (wire.identity?.stage === 'execution')
			this.#executions = [
				...this.#executions,
				{ goal: wire.identity.goal, duration: performance.now() - wire.sent },
			]
	}

	async #finish(wire: StudyOllamaExchange): Promise<void> {
		if (wire.settled) throw new StudyError('FAULT', 'Duplicate wire accounting')
		const terminal = wire.terminal
		const observation = this.#options.observe
			? { ...this.#timeline(wire), timing: buildStudyOllamaTiming(wire.timing) }
			: {}
		await wire.activity.context.evidence.append({
			event: 'wire',
			goal: wire.activity.goal,
			value: {
				role: wire.request.role,
				path: wire.request.path,
				model: wire.request.model ?? null,
				options: { ...wire.request.options },
				finish: terminal?.reason ?? null,
				prompt: terminal?.prompt ?? null,
				completion: terminal?.completion ?? null,
				bytes: wire.bytes,
				...(wire.identity === undefined ? {} : { ordinal: wire.identity.ordinal }),
				...observation,
			},
		})
		this.#settle(wire)
		try {
			wire.ticket.finish({
				role: wire.request.role,
				calls: 1,
				tokens:
					wire.request.role === 'metadata'
						? 0
						: terminal?.prompt !== undefined && terminal.completion !== undefined
							? terminal.prompt + terminal.completion
							: undefined,
				bytes: wire.bytes,
				duration: Math.ceil(performance.now() - wire.started),
			})
		} finally {
			this.#wires.delete(wire)
			wire.reader.releaseLock()
		}
	}

	// Accounts a request an Agent budget cut: the wire settles, the cut is retained as one `cut` row, and the request finishes with unknown tokens.
	#cut(wire: StudyOllamaExchange, error: BudgetError): Promise<void> {
		return this.#finalize(wire, () => this.#cutResponse(wire, error))
	}

	async #cutResponse(wire: StudyOllamaExchange, error: BudgetError): Promise<void> {
		if (wire.settled) return await this.#recordFailure(wire, error)
		this.#settle(wire)
		const observation = this.#options.observe ? this.#timeline(wire) : {}
		const stop = readStudyFailure(error).stop
		try {
			await this.#recordFailure(wire, error)
			await wire.activity.context.evidence.append({
				event: 'cut',
				goal: wire.activity.goal,
				value: {
					role: wire.request.role,
					path: wire.request.path,
					bytes: wire.bytes,
					status: wire.status,
					budget:
						stop === undefined
							? null
							: { id: stop.id, max: stop.max ?? null, consumed: stop.consumed ?? null },
					...observation,
				},
			})
			if (!wire.ticket.signal.aborted)
				wire.ticket.finish({
					role: wire.request.role,
					calls: 1,
					tokens: undefined,
					bytes: wire.bytes,
					duration: Math.ceil(performance.now() - wire.started),
				})
		} catch (failure) {
			this.fail(failure)
			if (!wire.ticket.settled && !wire.ticket.signal.aborted)
				wire.ticket.fail({ ...readStudyFailure(failure), role: wire.request.role })
			throw failure
		} finally {
			this.#requests.delete(wire.slot)
			this.#wires.delete(wire)
			await wire.reader.cancel(error).catch(() => undefined)
			wire.reader.releaseLock()
		}
	}

	#failWire(wire: StudyOllamaExchange, error: unknown): Promise<void> {
		return this.#finalize(wire, () => this.#failResponse(wire, error))
	}

	async #failResponse(wire: StudyOllamaExchange, error: unknown): Promise<void> {
		if (wire.settled) return await this.#recordFailure(wire, error)
		this.fail(error)
		this.#settle(wire)
		const observation = this.#options.observe ? this.#timeline(wire) : {}
		const failure = readStudyFailure(this.#fault?.error)
		try {
			if (!wire.ticket.signal.aborted) wire.ticket.fail({ ...failure, role: wire.request.role })
			await this.#recordFailure(wire, error)
			await wire.activity.context.evidence.append({
				event: 'failure',
				goal: wire.activity.goal,
				value: {
					role: wire.request.role,
					path: wire.request.path,
					bytes: wire.bytes,
					status: wire.status,
					// Bounded so a daemon-supplied message cannot grow the retained row.
					reason: failure.message.slice(0, 256),
					...observation,
				},
			})
		} finally {
			this.#requests.delete(wire.slot)
			this.#wires.delete(wire)
			await wire.reader.cancel(error).catch(() => undefined)
			wire.reader.releaseLock()
		}
	}
}
