import type { BudgetError } from '@orkestrel/budget'
import type { JSONValue } from '@orkestrel/contract'
import type { OllamaTiming } from '@orkestrel/ollama'
import type { StudyRole, StudyTicket } from '../../core/types.js'
import type { StudyAgentDispatch, StudyLatchInterface } from '../../core/agents/types.js'
import type {
	StudyOllamaActivity,
	StudyOllamaRequest,
	StudyOllamaSnapshot,
	StudyOllamaTerminal,
	StudyOllamaTransportOptions,
} from './types.js'
import { isBudgetError } from '@orkestrel/budget'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { StudyError } from '../../core/errors.js'
import { readStudyFailure } from '../../core/engines/helpers.js'
import { buildStudyAgentDispatch } from '../../core/agents/helpers.js'
import { studyStopToJSON } from '../../core/helpers.js'
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
} from './helpers.js'

/** Admits and accounts Ollama wire requests under declared policies and latches failure. */
export class StudyOllamaTransport implements StudyLatchInterface {
	readonly #options: StudyOllamaTransportOptions
	readonly #abort = new AbortController()
	readonly #wires = new Set<StudyOllamaExchange>()
	// The bound goal; `prepare` binds it and `clear` or `close` releases it. An admitted request keeps the goal it was admitted under.
	#goal: StudyOllamaGoal | undefined
	// Wraps the first retained failure so a thrown undefined or null is still a presence.
	#fault: { readonly error: unknown } | undefined
	#count = 0
	// The model of the latest model dispatch; it spans goals, so the next goal's first dispatch reports a switch.
	#previous: string | undefined

	/** Records immutable transport bounds and refuses a role policy the inventory cannot serve.
	 * @param options - Origin, room, request limit, pinned inventory, role policies, and cancellation.
	 */
	constructor(options: StudyOllamaTransportOptions) {
		const owned = buildStudyOllamaTransportOptions(options)
		validateStudyOllamaRoles(owned.roles, owned.models)
		this.#options = owned
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
		try {
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
		} catch (error) {
			this.fail(error)
			throw error
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
		try {
			// Everything the request depends on is owned before the first await; the caller's originals are never read again.
			const snapshot = buildStudyOllamaSnapshot(input, init, original)
			const settings = snapshot.init
			const request = readStudyOllamaRequest(this.#options, role, snapshot.url, settings)
			const limit = this.#options.limit
			if (request.bytes >= limit.bytes) {
				const message = 'Encoded request consumes the response byte allowance'
				throw new StudyError('CAPACITY', message, {
					cause: 'capacity',
					message,
					role: undefined,
					stop: { layer: 'scope', id: 'Wire bytes', max: limit.bytes, consumed: request.bytes },
				})
			}
			const ticket = await activity.context.meter.admit({
				role,
				tokens: role === 'metadata' ? 0 : this.#options.room.context - this.#options.room.safety,
				bytes: limit.bytes,
			})
			const id = ++this.#count
			const started = performance.now()
			const signal = AbortSignal.any([
				this.#options.signal,
				this.#abort.signal,
				activity.context.signal,
				activity.context.meter.signal,
				ticket.signal,
				AbortSignal.timeout(limit.duration),
				...(settings?.signal === undefined || settings.signal === null ? [] : [settings.signal]),
			])
			const wire = await this.#send(role, goal, ticket, request, snapshot, signal, id, started)
			this.#wires.add(wire)
			if (wire.status < 200 || wire.status > 299) return await this.#refuse(wire)
			return new Response(
				new ReadableStream<Uint8Array>({
					pull: (controller) => this.#pull(wire, controller),
					// A consumer cancel without a reason is the only absence; any thrown value keeps its identity.
					cancel: (reason: unknown) =>
						isBudgetError(reason)
							? this.#cut(wire, reason)
							: this.#failWire(
									wire,
									reason === undefined
										? new StudyError('FAULT', 'Ollama response cancelled before its end')
										: reason,
								),
				}),
				{
					status: wire.status,
					headers: {
						'content-type':
							role === 'judge' || role === 'metadata' ? 'application/json' : 'application/x-ndjson',
					},
				},
			)
		} catch (error) {
			this.fail(error)
			throw error
		}
	}

	/** Cancels every outstanding native reader and permanently closes the transport.
	 * @returns Completion after finite native cancellation.
	 */
	async close(): Promise<void> {
		this.#abort.abort(new StudyError('FAULT', 'Ollama transport closed'))
		await Promise.all(
			[...this.#wires].map((wire) => this.#failWire(wire, this.#abort.signal.reason)),
		)
		this.#goal = undefined
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
				const chunk = await wire.reader.read()
				wire.signal.throwIfAborted()
				if (chunk.done) break
				wire.count(chunk.value.byteLength, this.#options.limit.bytes)
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

	async #pull(
		wire: StudyOllamaExchange,
		controller: ReadableStreamDefaultController<Uint8Array>,
	): Promise<void> {
		try {
			wire.signal.throwIfAborted()
			const chunk = await wire.reader.read()
			wire.signal.throwIfAborted()
			if (!chunk.done) {
				wire.count(chunk.value.byteLength, this.#options.limit.bytes)
				wire.decode(chunk.value)
				if (wire.request.role !== 'metadata' && wire.request.role !== 'judge')
					this.#rows(wire, false)
				controller.enqueue(chunk.value)
				return
			}
			wire.flush()
			if (wire.request.role === 'metadata') {
				const value: unknown = JSON.parse(wire.text)
				if (wire.request.path === '/api/tags')
					validateStudyOllamaInventory(value, this.#options.models)
				else readStudyOllamaSupport(value, this.#options.room.context)
			} else if (wire.request.role === 'judge') {
				this.#observe(wire, JSON.parse(wire.text))
			} else this.#rows(wire, true)
			if (wire.request.role !== 'metadata' && wire.terminal === undefined)
				throw new StudyError('FAULT', 'Ollama response has no terminal row')
			await this.#finish(wire)
			if (wire.terminal !== undefined) await this.#judge(wire, wire.terminal)
			controller.close()
		} catch (error) {
			this.fail(error)
			try {
				if (isBudgetError(error)) await this.#cut(wire, error)
				else await this.#failWire(wire, error)
			} finally {
				controller.error(error)
			}
		}
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
	): Promise<StudyOllamaExchange> {
		const { url, init: settings, dispatch } = snapshot
		try {
			signal.throwIfAborted()
			await goal.activity.context.evidence.append({
				event: 'dispatch',
				goal: goal.activity.goal,
				value: {
					role,
					path: request.path,
					model: request.model ?? null,
					options: { ...request.options },
					bytes: request.bytes,
					...(this.#options.observe ? this.#dispatch(goal, request, id, settings, dispatch) : {}),
				},
			})
			signal.throwIfAborted()
			const sent = performance.now()
			const response = await globalThis.fetch(url, { ...settings, signal, redirect: 'error' })
			if (response.body === null)
				throw new StudyError('FAULT', `Ollama HTTP response refused: ${response.status}`)
			return new StudyOllamaExchange({
				activity: goal.activity,
				request,
				ticket,
				signal,
				reader: response.body.getReader(),
				decoder: new TextDecoder('utf-8', { fatal: true }),
				status: response.status,
				started,
				id,
				sent,
				dispatch,
				bytes: request.bytes,
			})
		} catch (error) {
			if (!ticket.signal.aborted) {
				// An Agent budget's cut before the wire exists is Agent's own stop: the request is accounted with unknown cost.
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
			throw error
		}
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
				...observation,
			},
		})
		wire.settle()
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
	async #cut(wire: StudyOllamaExchange, error: BudgetError): Promise<void> {
		if (wire.settled) return
		wire.settle()
		const observation = this.#options.observe ? this.#timeline(wire) : {}
		const stop = readStudyFailure(error).stop
		try {
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
			this.#wires.delete(wire)
			await wire.reader.cancel(error).catch(() => undefined)
			wire.reader.releaseLock()
		}
	}

	async #failWire(wire: StudyOllamaExchange, error: unknown): Promise<void> {
		if (wire.settled) return
		this.fail(error)
		wire.settle()
		const observation = this.#options.observe ? this.#timeline(wire) : {}
		const failure = readStudyFailure(this.#fault?.error)
		try {
			if (!wire.ticket.signal.aborted) wire.ticket.fail({ ...failure, role: wire.request.role })
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
			this.#wires.delete(wire)
			await wire.reader.cancel(error).catch(() => undefined)
			wire.reader.releaseLock()
		}
	}
}
