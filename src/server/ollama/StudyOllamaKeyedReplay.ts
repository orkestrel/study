import type {
	StudyOllamaFetchFunction,
	StudyOllamaKeyedReplayOptions,
	StudyOllamaReplayInterface,
} from './types.js'
import type { StudyExchangeReply, StudyRecordedExchange } from '../stores/types.js'
import { StudyError } from '@src/core'
import { isBudgetError } from '@orkestrel/budget'
import { validateStudyExchangeHistory } from '../stores/helpers.js'
import {
	buildStudyOllamaKey,
	describeStudyReplayDifference,
	splitStudyOllamaChunks,
} from './helpers.js'

/** Serves a listed role's request from the recorded exchange its role, path, method, and body bytes equal. */
export class StudyOllamaKeyedReplay implements StudyOllamaReplayInterface {
	readonly #options: Omit<StudyOllamaKeyedReplayOptions, 'histories'>
	readonly #exchanges: ReadonlyMap<string, StudyRecordedExchange>
	readonly #readers = new Set<ReadableStream<Uint8Array>>()
	readonly #served = new WeakSet<Response>()
	#fault: { readonly error: unknown } | undefined
	#closed = false
	#reached = false

	/** Owns and revalidates every selected history before any sender can be reached.
	 * @param options - Verified histories, listed roles, executing origin, and the optional live sender.
	 */
	constructor(options: StudyOllamaKeyedReplayOptions) {
		const { histories, signal, fetch, roles, url } = options
		for (const history of histories) validateStudyExchangeHistory(history)
		const location = new URL(url)
		if (
			!['http:', 'https:'].includes(location.protocol) ||
			location.username !== '' ||
			location.password !== '' ||
			location.search !== '' ||
			location.hash !== '' ||
			location.pathname !== '/' ||
			roles.length === 0 ||
			(fetch !== undefined && typeof fetch !== 'function')
		)
			throw new StudyError('CONFIG', 'Keyed replay requires listed roles and an explicit origin')
		signal.throwIfAborted()
		this.#options = {
			roles: [...roles],
			url,
			signal,
			...(fetch === undefined ? {} : { fetch }),
		}
		// Reversed so the first recorded exchange of a repeated key is the one the lookup retains.
		this.#exchanges = new Map(
			histories
				.flatMap((history) => history.exchanges)
				.map(({ attempt, response }) => ({
					key: buildStudyOllamaKey(
						attempt.role,
						attempt.path,
						attempt.method,
						Buffer.from(attempt.body, 'base64'),
					),
					pair: { attempt, response },
				}))
				.toReversed()
				.map(({ key, pair }): readonly [string, StudyRecordedExchange] => [key, pair]),
		)
	}

	/** Answers a listed role's recorded request, sends any other live, and refuses a miss with no live sender.
	 * @param role - The validated Study responsibility.
	 * @param input - The executing origin and exact route.
	 * @param init - The method, encoded body and bounded signal.
	 * @returns The recorded response, which `served` then recognizes, or the live collaborator's response.
	 */
	readonly fetch: StudyOllamaFetchFunction = async (role, input, init) => {
		this.#reached = true
		try {
			if (this.#closed) throw new StudyError('FAULT', 'Keyed replay is closed')
			this.check()
			init.signal?.throwIfAborted()
			const url = new URL(input)
			const request = new Request(url, init)
			const body = Buffer.from(await request.arrayBuffer())
			const pair =
				this.#options.roles.includes(role) && this.#matches(url)
					? this.#exchanges.get(buildStudyOllamaKey(role, url.pathname, request.method, body))
					: undefined
			if (pair !== undefined) return this.#serve(pair.response, init)
			if (this.#options.fetch === undefined)
				throw new StudyError(
					'FAULT',
					describeStudyReplayDifference(undefined, {
						ordinal: 0,
						path: url.pathname,
						method: request.method,
						role,
						body,
					}) ?? 'Keyed replay holds no recorded exchange',
				)
			return await this.#options.fetch(role, input, init)
		} catch (error) {
			// An Agent budget's cut is reported by Agent's own result, so nothing is retained to re-raise.
			if (!isBudgetError(error)) this.#fault ??= { error }
			throw error
		}
	}

	/** Reports whether this replay answered a response from the recording.
	 * @param response - The response its `fetch` returned.
	 * @returns True if the response came from a recorded exchange; false otherwise.
	 */
	readonly served = (response: Response): boolean => this.#served.has(response)

	/** Refuses a latched failure or cancellation. */
	check(): void {
		if (this.#fault !== undefined) throw this.#fault.error
		this.#options.signal.throwIfAborted()
	}

	/** Closes admission and cancels retained replay responses.
	 * @returns Completion after owned readers settle.
	 * @throws StudyError - Thrown with code `FAULT` when an offline replay was never reached, so an adapter that ignores it cannot read as offline.
	 */
	async close(): Promise<void> {
		const first = !this.#closed
		this.#closed = true
		await Promise.allSettled([...this.#readers].map((reader) => reader.cancel()))
		this.#readers.clear()
		if (
			first &&
			!this.#reached &&
			this.#options.fetch === undefined &&
			this.#fault === undefined &&
			!this.#options.signal.aborted
		)
			throw new StudyError('FAULT', 'Offline keyed replay was never reached by the adapter')
	}

	#matches(url: URL): boolean {
		return (
			url.origin === new URL(this.#options.url).origin &&
			url.username === '' &&
			url.password === '' &&
			url.search === '' &&
			url.hash === ''
		)
	}

	#serve(reply: StudyExchangeReply, init: RequestInit): Response {
		const source = splitStudyOllamaChunks(Buffer.from(reply.body, 'base64'), reply.chunks).values()
		const stream = new ReadableStream<Uint8Array>(
			{
				pull: (controller) => {
					if (this.#options.signal.aborted || init.signal?.aborted || this.#closed) {
						const error =
							this.#options.signal.reason ??
							init.signal?.reason ??
							new StudyError('FAULT', 'Keyed replay response was closed')
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
				},
			},
			{ highWaterMark: 0 },
		)
		this.#readers.add(stream)
		const served = new Response(stream, {
			status: reply.status,
			headers: reply.headers
				.filter(([name]) => name !== 'content-encoding')
				.map(([name, value]): [string, string] => [name, value]),
		})
		this.#served.add(served)
		return served
	}
}
