import type { JSONValue } from '@orkestrel/contract'
import type { StudyRole } from '../../core/types.js'
import type { StudyAgentDispatch, StudyLatchInterface } from '../../core/agents/types.js'
import type {
	StudyOllamaActivity,
	StudyOllamaRequest,
	StudyOllamaTransportOptions,
	StudyOllamaWire,
} from './types.js'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { StudyError } from '../../core/errors.js'
import { readStudyFailure } from '../../core/engines/helpers.js'
import { buildStudyAgentDispatch } from '../../core/agents/helpers.js'
import { buildStudyOllamaOptions, buildStudyOllamaSnapshot } from './cloners.js'
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
	readonly #wires = new Set<StudyOllamaWire>()
	#activity: StudyOllamaActivity | undefined
	// Wraps the first retained failure so a thrown undefined or null is still a presence.
	#fault: { readonly error: unknown } | undefined
	#count = 0
	#previous: string | undefined
	#attached = false

	/** Records immutable transport bounds and refuses a role policy the inventory cannot serve.
	 * @param options - Origin, room, request limit, pinned inventory, role policies, and cancellation.
	 */
	constructor(options: StudyOllamaTransportOptions) {
		const owned = buildStudyOllamaOptions(options)
		validateStudyOllamaRoles(owned.roles, owned.models)
		this.#options = owned
	}

	/** Binds subsequent wire requests to one live goal.
	 * @param activity - The goal's accounting boundary.
	 */
	prepare(activity: StudyOllamaActivity): void {
		this.check()
		if (this.#wires.size !== 0)
			throw new StudyError('FAULT', 'Previous model response is still open')
		this.#activity = activity
		this.#attached = false
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
	 * @param error - The observed failure; the first retained failure keeps its identity.
	 */
	fail(error: unknown): void {
		this.#fault ??= { error }
	}

	/** Checks every pinned serving identity through admitted inventory and metadata requests.
	 * @returns Completion after inventory validation and support evidence.
	 */
	async verify(): Promise<void> {
		try {
			const response = await this.fetch('metadata', new URL('/api/tags', this.#options.url), {
				method: 'GET',
			})
			const value: unknown = await response.json()
			validateStudyOllamaInventory(value, this.#options.models)
			const activity = this.#activity
			if (activity === undefined) throw new StudyError('FAULT', 'Inventory has no goal attribution')
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
	 * @throws StudyError - Thrown with the recognized provider failure or a role-attributed `FAULT` for a non-2xx response, after its bounded body was read and its request accounted once.
	 */
	async fetch(
		role: StudyRole,
		input: string | URL | Request,
		init?: RequestInit,
		original?: StudyAgentDispatch,
	): Promise<Response> {
		this.check()
		const activity = this.#activity
		if (activity === undefined)
			throw new StudyError('FAULT', 'Model dispatch outside an active goal')
		let wire: StudyOllamaWire | undefined
		try {
			// Everything the request depends on is owned before the first await; the caller's originals are never read again.
			const { url, init: settings, dispatch } = buildStudyOllamaSnapshot(input, init, original)
			const request = readStudyOllamaRequest(this.#options, role, url, settings)
			const limit = this.#options.limit
			if (request.bytes >= limit.bytes)
				throw new StudyError('CAPACITY', 'Encoded request consumes the response byte allowance')
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
			try {
				signal.throwIfAborted()
				await activity.context.evidence.append({
					event: 'dispatch',
					goal: activity.goal,
					value: {
						role,
						path: request.path,
						model: request.model ?? null,
						options: { ...request.options },
						bytes: request.bytes,
						...(this.#options.observe
							? this.#dispatch(activity, request, id, settings, dispatch)
							: {}),
					},
				})
				signal.throwIfAborted()
				const sent = performance.now()
				const response = await globalThis.fetch(url, { ...settings, signal, redirect: 'error' })
				if (response.body === null)
					throw new StudyError('FAULT', `Ollama HTTP response refused: ${response.status}`)
				const opened: StudyOllamaWire = {
					activity,
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
					text: '',
					terminal: undefined,
					timing: undefined,
					settled: false,
				}
				wire = opened
				this.#wires.add(opened)
				if (!response.ok) return await this.#refuse(opened)
				return new Response(
					new ReadableStream<Uint8Array>({
						pull: (controller) => this.#pull(opened, controller),
						// A consumer cancel without a reason is the only absence; any thrown value keeps its identity.
						cancel: (reason: unknown) =>
							this.#cancel(
								opened,
								reason === undefined
									? new StudyError('FAULT', 'Ollama response cancelled before its end')
									: reason,
							),
					}),
					{
						status: response.status,
						headers: {
							'content-type':
								role === 'judge' || role === 'metadata'
									? 'application/json'
									: 'application/x-ndjson',
						},
					},
				)
			} catch (error) {
				if (wire === undefined && !ticket.signal.aborted)
					ticket.fail({ ...readStudyFailure(error), role })
				throw error
			}
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
		await Promise.all([...this.#wires].map((wire) => this.#cancel(wire, this.#abort.signal.reason)))
		this.#activity = undefined
	}

	// Buffers a non-2xx body under the wire bounds and parses it once at its end, because an error body is one JSON document, not rows.
	async #refuse(wire: StudyOllamaWire): Promise<never> {
		// A lenient decoder: undecodable bytes make the body invalid JSON, which is a generic refusal rather than a decode crash.
		const decoder = new TextDecoder()
		let text = ''
		let failure: unknown
		try {
			for (;;) {
				wire.signal.throwIfAborted()
				const chunk = await wire.reader.read()
				wire.signal.throwIfAborted()
				if (chunk.done) break
				wire.bytes += chunk.value.byteLength
				if (wire.bytes > this.#options.limit.bytes) {
					const message = 'Ollama wire byte allowance exceeded'
					throw new StudyError('CAPACITY', message, {
						cause: 'capacity',
						message,
						role: wire.request.role,
					})
				}
				text += decoder.decode(chunk.value, { stream: true })
			}
			const body: unknown = parseJSON(text + decoder.decode())
			const message = `Ollama HTTP response refused: ${wire.status}`
			failure =
				readStudyOllamaFailure(body, wire.request.role, wire.status) ??
				new StudyError('FAULT', message, {
					cause: 'infrastructure',
					message,
					role: wire.request.role,
				})
		} catch (error) {
			failure = error
		}
		await this.#cancel(wire, failure)
		throw failure
	}

	async #pull(
		wire: StudyOllamaWire,
		controller: ReadableStreamDefaultController<Uint8Array>,
	): Promise<void> {
		try {
			wire.signal.throwIfAborted()
			const chunk = await wire.reader.read()
			wire.signal.throwIfAborted()
			if (!chunk.done) {
				wire.bytes += chunk.value.byteLength
				if (wire.bytes > this.#options.limit.bytes) {
					const message = 'Ollama wire byte allowance exceeded'
					throw new StudyError('CAPACITY', message, {
						cause: 'capacity',
						message,
						role: wire.request.role,
					})
				}
				wire.text += wire.decoder.decode(chunk.value, { stream: true })
				if (wire.request.role !== 'metadata' && wire.request.role !== 'judge')
					this.#rows(wire, false)
				controller.enqueue(chunk.value)
				return
			}
			wire.text += wire.decoder.decode()
			if (wire.request.role === 'metadata') {
				const value: unknown = JSON.parse(wire.text)
				if (wire.request.path === '/api/tags')
					validateStudyOllamaInventory(value, this.#options.models)
				else readStudyOllamaSupport(value, this.#options.room.context)
			} else if (wire.request.role === 'judge') {
				const row: unknown = JSON.parse(wire.text)
				wire.terminal = readStudyOllamaTerminal(row, wire.request)
				this.#time(wire, row)
			} else this.#rows(wire, true)
			if (wire.request.role !== 'metadata' && wire.terminal === undefined)
				throw new StudyError('FAULT', 'Ollama response has no terminal row')
			await this.#finish(wire)
			if (wire.terminal !== undefined)
				validateStudyOllamaCompletion(wire.terminal, this.#options.room, wire.request)
			controller.close()
		} catch (error) {
			this.fail(error)
			await this.#cancel(wire, error)
			controller.error(error)
		}
	}

	#rows(wire: StudyOllamaWire, final: boolean): void {
		const lines = wire.text.split(/\r\n|\n/)
		wire.text = final ? '' : (lines.pop() ?? '')
		for (const line of lines) {
			if (line.trim() === '') continue
			if (wire.terminal !== undefined)
				throw new StudyError('FAULT', 'Ollama emitted a row after its terminal')
			const row: unknown = JSON.parse(line)
			wire.terminal = readStudyOllamaTerminal(row, wire.request)
			this.#time(wire, row)
		}
	}

	#time(wire: StudyOllamaWire, row: unknown): void {
		if (this.#options.observe && wire.terminal !== undefined && isRecord(row))
			wire.timing = readStudyOllamaTiming(this.#options.timing, row)
	}

	#dispatch(
		activity: StudyOllamaActivity,
		request: StudyOllamaRequest,
		id: number,
		init: RequestInit | undefined,
		dispatch: StudyAgentDispatch | undefined,
	): Readonly<Record<string, JSONValue>> {
		const previous = this.#previous
		const model = request.role !== 'metadata'
		if (model) this.#previous = request.model
		const snapshot = activity.checkpoint !== undefined && !this.#attached
		if (snapshot) this.#attached = true
		const raw = buildStudyOllamaRaw(init?.body)
		return {
			id,
			...buildStudyAgentDispatch(dispatch),
			...(raw === undefined ? {} : { raw }),
			digest: readStudyOllamaDigest(this.#options.models, request) ?? null,
			previous: previous ?? null,
			changed: model && previous !== undefined && previous !== request.model,
			...(request.strict ? { strict: true } : {}),
			...(activity.checkpoint === undefined
				? {}
				: { body: typeof init?.body === 'string' ? init.body : null }),
			...(snapshot && activity.checkpoint !== undefined ? { snapshot: activity.checkpoint } : {}),
		}
	}

	#timeline(wire: StudyOllamaWire): Readonly<Record<string, JSONValue>> {
		return {
			id: wire.id,
			...buildStudyAgentDispatch(wire.dispatch),
			started: wire.started,
			sent: wire.sent,
			elapsed: performance.now() - wire.sent,
		}
	}

	async #finish(wire: StudyOllamaWire): Promise<void> {
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
		wire.settled = true
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

	async #cancel(wire: StudyOllamaWire, error: unknown): Promise<void> {
		if (wire.settled) return
		this.fail(error)
		wire.settled = true
		const observation = this.#options.observe ? this.#timeline(wire) : {}
		const failure = readStudyFailure(this.#fault?.error)
		try {
			if (!wire.ticket.signal.aborted) wire.ticket.fail({ ...failure, role: wire.request.role })
			await wire.activity.context.evidence.append({
				event: 'wire-failure',
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
