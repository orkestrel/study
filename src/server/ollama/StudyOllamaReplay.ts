import type { StudyRole } from '@src/core'
import type {
	StudyOllamaFetchFunction,
	StudyOllamaReplayInterface,
	StudyOllamaReplayOptions,
	StudyOllamaStep,
} from './types.js'
import { StudyError } from '@src/core'
import { validateStudyExchangeHistory } from '../stores/helpers.js'
import { isStudyOllamaMetadata } from './validators.js'

/** Answers declared HTTP prefixes from complete ordered recorded application bytes. */
export class StudyOllamaReplay implements StudyOllamaReplayInterface {
	readonly #options: StudyOllamaReplayOptions
	readonly #readers = new Set<ReadableStream<Uint8Array>>()
	readonly #pending = new Set<Promise<Response>>()
	readonly #started = performance.now()
	#cursor: number
	#bytes = 0
	#calls = 0
	#fault: { readonly error: unknown } | undefined
	#closed = false
	readonly #procedure: readonly StudyOllamaStep[]

	/** Owns and revalidates the complete selected history before any sender can be reached.
	 * @param options - Verified history, explicit prefix, executing origin and independent bounds.
	 */
	constructor(options: StudyOllamaReplayOptions) {
		const { signal, fetch, ...configuration } = options
		const owned = structuredClone(configuration)
		validateStudyExchangeHistory(owned.history)
		const url = new URL(owned.url)
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username !== '' ||
			url.password !== '' ||
			url.search !== '' ||
			url.hash !== '' ||
			url.pathname !== '/' ||
			!Number.isSafeInteger(owned.prefix) ||
			owned.prefix <= 0 ||
			owned.prefix > owned.history.exchanges.length ||
			(fetch === undefined && owned.prefix !== owned.history.exchanges.length) ||
			(fetch !== undefined && typeof fetch !== 'function') ||
			!isStudyOllamaMetadata(owned.limit)
		)
			throw new StudyError(
				'CONFIG',
				'Replay requires an explicit valid origin, prefix and current bounds',
			)
		if (owned.prefix < owned.history.declaration.maintenance.length)
			throw new StudyError('CONFIG', 'Replay prefix omits recorded maintenance')
		signal.throwIfAborted()
		this.#options = { ...owned, signal, ...(fetch === undefined ? {} : { fetch }) }
		this.#cursor = owned.history.declaration.maintenance.length
		this.#procedure = (owned.history.declaration.procedure ?? []).map((step) => {
			const pair = owned.history.exchanges.find(
				(entry) => entry.attempt.step === step.ordinal && entry.attempt.ordinal <= owned.prefix,
			)
			if (pair === undefined) return step
			const { admission: _admission, ...identity } = step
			const { bytes: _bytes, ...exact } = identity
			return {
				...exact,
				admission: 'exact',
				body: new TextDecoder('utf-8', { fatal: true }).decode(
					Buffer.from(pair.attempt.body, 'base64'),
				),
				input: pair.attempt.digest,
			}
		})
	}

	/** Holds exact recorded bodies for model requests inside the declared prefix. */
	get procedure(): readonly StudyOllamaStep[] {
		return structuredClone(this.#procedure)
	}

	/** Supplies recorded native responses, forwarding only after the exact declared prefix.
	 * @param role - The validated Study responsibility.
	 * @param input - The executing origin and exact route.
	 * @param init - The method, encoded body and bounded signal.
	 * @returns The recorded response or the explicit live collaborator's response.
	 */
	readonly fetch: StudyOllamaFetchFunction = (role, input, init) => {
		if (
			this.#closed ||
			this.#fault !== undefined ||
			this.#pending.size !== 0 ||
			this.#readers.size !== 0
		) {
			const error =
				this.#fault?.error ??
				new StudyError(
					'FAULT',
					'Replay request is closed, concurrent or follows an unread response',
				)
			this.#fault ??= { error }
			return Promise.reject(error)
		}
		const pending = this.#fetch(role, input, init).catch((error: unknown) => {
			this.#fault ??= { error }
			throw error
		})
		this.#pending.add(pending)
		void pending.then(
			() => this.#pending.delete(pending),
			() => this.#pending.delete(pending),
		)
		return pending
	}

	/** Refuses a mismatch, an unread response or an incompletely consumed prefix. */
	check(): void {
		if (this.#fault !== undefined) throw this.#fault.error
		this.#options.signal.throwIfAborted()
		if (this.#cursor < this.#options.prefix || this.#readers.size !== 0 || this.#pending.size !== 0)
			throw new StudyError('FAULT', 'Replay prefix is incomplete or still being read')
	}

	/** Closes admission and cancels retained replay responses.
	 * @returns Completion after pending sends and owned readers settle.
	 */
	async close(): Promise<void> {
		this.#closed = true
		await Promise.allSettled([...this.#readers].map((reader) => reader.cancel()))
		this.#readers.clear()
		await Promise.allSettled([...this.#pending])
	}

	async #fetch(role: StudyRole, input: string | URL, init: RequestInit): Promise<Response> {
		this.#options.signal.throwIfAborted()
		init.signal?.throwIfAborted()
		if (this.#cursor >= this.#options.prefix) {
			if (this.#options.fetch === undefined)
				throw new StudyError('FAULT', 'Offline replay has no later sender')
			return this.#options.fetch(role, input, init)
		}
		const pair = this.#options.history.exchanges[this.#cursor]
		const url = new URL(input)
		const request = new Request(url, init)
		const body = Buffer.from(await request.arrayBuffer())
		if (
			pair === undefined ||
			url.origin !== new URL(this.#options.url).origin ||
			url.username !== '' ||
			url.password !== '' ||
			url.search !== '' ||
			url.hash !== '' ||
			url.pathname !== pair.attempt.path ||
			request.method !== pair.attempt.method ||
			role !== pair.attempt.role ||
			!body.equals(Buffer.from(pair.attempt.body, 'base64'))
		)
			throw new StudyError('FAULT', 'Replay request differs from the next recorded exchange')
		this.#calls += 1
		this.#bytes += body.length + pair.response.size
		if (this.#calls > this.#options.limit.calls || this.#bytes > this.#options.limit.bytes)
			throw new StudyError('CAPACITY', 'Replay exceeds the executing allowance')
		if (performance.now() - this.#started >= this.#options.limit.duration)
			throw new StudyError('DEADLINE', 'Replay exceeds the executing duration')
		this.#cursor += 1
		const bytes = Buffer.from(pair.response.body, 'base64')
		const chunks = pair.response.chunks.map((size, index, sizes) => {
			const offset = sizes.slice(0, index).reduce((total, length) => total + length, 0)
			return bytes.subarray(offset, offset + size)
		})
		const source = chunks.values()
		const stream = new ReadableStream<Uint8Array>(
			{
				pull: (controller) => {
					if (this.#options.signal.aborted || init.signal?.aborted || this.#closed) {
						const error =
							this.#options.signal.reason ??
							init.signal?.reason ??
							new StudyError('FAULT', 'Replay response was closed')
						this.#fault ??= { error }
						this.#readers.delete(stream)
						controller.error(error)
						return
					}
					const chunk = source.next()
					if (chunk.done) {
						controller.close()
						this.#readers.delete(stream)
					} else controller.enqueue(chunk.value)
				},
				cancel: () => {
					this.#readers.delete(stream)
					this.#fault ??= { error: new StudyError('FAULT', 'Replay response was abandoned') }
				},
			},
			{ highWaterMark: 0 },
		)
		this.#readers.add(stream)
		return new Response(stream, {
			status: pair.response.status,
			headers: pair.response.headers
				.filter(([name]) => name !== 'content-encoding')
				.map(([name, value]): [string, string] => [name, value]),
		})
	}
}
