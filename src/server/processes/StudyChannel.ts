import type { StudyChannelOptions, StudyFrame, StudyOperation, StudyResponse } from './types.js'
import type { JSONValue } from '@orkestrel/contract'
import { StudyControl, failureToStudyError, readStudyFailure } from '../../core/engines/index.js'
import { STUDY_FRAME_BYTES, STUDY_PENDING_LIMIT } from './constants.js'
import { createStudyProcessFailure, valueToWire } from './helpers.js'
import { isStudyFrame, isStudyProcessFailure } from './validators.js'

/** Correlates bounded IPC work and rejects every outstanding request on transport failure. */
export class StudyChannel {
	#options: StudyChannelOptions
	#control = new StudyControl()
	readonly #pending = new Map<number, StudyResponse>()
	#next = 0
	#received = 0
	readonly #working = new Set<Promise<void>>()
	#message: (value: unknown) => void
	#disconnect: () => void
	#error: (error: Error) => void

	/** Subscribes to one native IPC endpoint.
	 * @param options - Native endpoint and owning domain handlers; the bag is snapshotted while selected collaborators keep their identity.
	 */
	constructor(options: StudyChannelOptions) {
		this.#options = { ...options }
		this.#message = this.#onMessage.bind(this)
		this.#disconnect = this.#onDisconnect.bind(this)
		this.#error = this.close.bind(this)
		this.#options.endpoint.on('message', this.#message)
		this.#options.endpoint.on('disconnect', this.#disconnect)
		this.#options.endpoint.on('error', this.#error)
	}

	get signal(): AbortSignal {
		return this.#control.signal
	}

	#onMessage(value: unknown): void {
		void this.#receive(value).catch((error: unknown) => this.close(error))
	}

	#onDisconnect(): void {
		this.close(failureToStudyError(createStudyProcessFailure('Study process disconnected')))
	}

	/** Sends one correlated domain request.
	 * @param operation - The domain operation expected by the peer.
	 * @param value - Public JSON payload.
	 * @returns The peer's acknowledged result.
	 */
	request(operation: StudyOperation, value: JSONValue): Promise<JSONValue> {
		if (this.#control.failure !== undefined)
			return Promise.reject(failureToStudyError(this.#control.failure))
		if (this.#pending.size >= STUDY_PENDING_LIMIT)
			return Promise.reject(
				failureToStudyError(createStudyProcessFailure('Study IPC pending limit exceeded')),
			)
		const id = ++this.#next
		return new Promise<JSONValue>((resolve, reject) => {
			this.#pending.set(id, { resolve, reject })
			this.#send({ id, operation, value }).catch((error: unknown) => this.close(error))
		})
	}

	/** Forwards cancellation without closing the cleanup transport.
	 * @param value - Validated goal, trial or ticket cancellation attribution.
	 */
	abort(value: JSONValue): void {
		void this.#send({ id: 0, operation: 'abort', value }).catch((error: unknown) =>
			this.close(error),
		)
	}

	/** Removes endpoint handlers and rejects all unresolved calls.
	 * @param error - The first transport or owning lifecycle failure.
	 */
	close(
		error: unknown = failureToStudyError(createStudyProcessFailure('Study channel closed')),
	): void {
		this.#control.fail(readStudyFailure(error))
		this.#options.endpoint.removeListener('message', this.#message)
		this.#options.endpoint.removeListener('disconnect', this.#disconnect)
		this.#options.endpoint.removeListener('error', this.#error)
		for (const pending of this.#pending.values())
			pending.reject(failureToStudyError(this.#control.failure ?? readStudyFailure(error)))
		this.#pending.clear()
		this.#control.close()
	}

	async #send(frame: StudyFrame): Promise<void> {
		if (Buffer.byteLength(JSON.stringify(frame)) > STUDY_FRAME_BYTES)
			throw failureToStudyError(createStudyProcessFailure('Study IPC frame limit exceeded'))
		if (!this.#options.endpoint.connected || this.#options.endpoint.send === undefined)
			throw failureToStudyError(createStudyProcessFailure('Study IPC is unavailable'))
		await new Promise<void>((resolve, reject) => {
			this.#options.endpoint.send?.(frame, undefined, {}, (error: Error | null) =>
				error === null ? resolve() : reject(error),
			)
		})
	}

	async #receive(value: unknown): Promise<void> {
		if (!isStudyFrame(value) || Buffer.byteLength(JSON.stringify(value)) > STUDY_FRAME_BYTES)
			throw failureToStudyError(createStudyProcessFailure('Malformed study IPC frame'))
		if (value.operation === 'abort') {
			if (value.id !== 0)
				throw failureToStudyError(createStudyProcessFailure('Foreign study cancellation'))
			this.#options.abort(value.value)
			return
		}
		if (value.operation === 'reply' || value.operation === 'error') {
			const pending = this.#pending.get(value.id)
			if (pending === undefined)
				throw failureToStudyError(createStudyProcessFailure('Unknown study IPC reply'))
			if (value.operation === 'reply') pending.resolve(value.value)
			else {
				if (!isStudyProcessFailure(value.value))
					throw failureToStudyError(createStudyProcessFailure('Invalid study IPC failure'))
				pending.reject(failureToStudyError(value.value))
			}
			this.#pending.delete(value.id)
			return
		}
		if (value.id !== this.#received + 1 || this.#working.size >= STUDY_PENDING_LIMIT)
			throw failureToStudyError(
				createStudyProcessFailure('Out-of-order or excessive study IPC request'),
			)
		this.#received = value.id
		const working = this.#respond(value.id, value.operation, value.value)
		this.#working.add(working)
		try {
			await working
		} finally {
			this.#working.delete(working)
		}
	}

	// Hands one accepted request to its domain handler and sends the reply, or the error that stopped it.
	async #respond(id: number, operation: StudyOperation, value: JSONValue): Promise<void> {
		try {
			const result = await this.#options.handle(operation, value)
			await this.#send({ id, operation: 'reply', value: result })
		} catch (error) {
			await this.#send({
				id,
				operation: 'error',
				value: valueToWire(readStudyFailure(error)),
			})
		}
	}
}
