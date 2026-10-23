import type { OllamaDaemonInterface } from '@orkestrel/ollama/server'
import type { StudyDaemonTrialOptions } from './types.js'
import type {
	StudyExchangeDestination,
	StudyExchangeIdentity,
	StudyExchangeReply,
	StudyExchangeSinkInterface,
} from '../stores/types.js'
import { StudyError } from '@src/core'
import { open } from 'node:fs/promises'
import { StudyExchangeSink } from '../stores/StudyExchangeSink.js'
import { readStudyBytes } from '../stores/helpers.js'
import { buildStudyOllamaBytes } from '../ollama/helpers.js'
import { hashStudyBytes } from '../helpers.js'

/** Records one trial's daemon maintenance before handing its verified prefix to a worker.
 * @example
 * ```ts
 * const trial = new StudyDaemonTrial(options)
 * await trial.execute(daemon)
 * ```
 */
export class StudyDaemonTrial {
	readonly #options: StudyDaemonTrialOptions
	readonly #pending = new Map<StudyExchangeIdentity, StudyExchangeReply>()
	#sink: StudyExchangeSinkInterface | undefined

	/** Owns the declaration and reserved destination for one preparation.
	 * @param options - The immutable trial declaration, destination, and cancellation.
	 */
	constructor(options: StudyDaemonTrialOptions) {
		this.#options = {
			...options,
			declaration: structuredClone(options.declaration),
			destination: structuredClone(options.destination),
		}
	}

	/** Unloads declared models, drains the journal, and returns its exact retained identity.
	 * @remarks The daemon's unload sender must call this instance's fetch method. Startup metadata must forward without recording.
	 * @param daemon - The verified execution-owned daemon.
	 * @returns The original destination with its closed maintenance prefix identity.
	 */
	async execute(daemon: OllamaDaemonInterface): Promise<StudyExchangeDestination> {
		if (this.#sink !== undefined) throw new StudyError('FAULT', 'Daemon preparation cannot repeat')
		const file = await open(this.#options.destination.path, 'wx')
		this.#sink = new StudyExchangeSink({ file, record: this.#options.destination.record })
		try {
			await this.#sink.append(this.#options.declaration)
			await daemon.unload()
			await this.#finish()
		} catch (error) {
			await this.#finish(error)
			throw error
		} finally {
			await this.#sink.close()
		}
		const bytes = await readStudyBytes(
			this.#options.destination.path,
			this.#options.destination.record.bytes,
		)
		return {
			...this.#options.destination,
			retained: {
				path: `trials/${this.#options.declaration.trial}/exchanges.jsonl`,
				bytes: bytes.length,
				digest: hashStudyBytes(bytes),
			},
		}
	}

	/** Retains each request before sending and preserves the sender's native response chunks.
	 * @param input - The daemon's exact HTTP input.
	 * @param init - The daemon's method, body, redirect policy, and cancellation.
	 * @returns An unread response carrying the same body bytes for daemon validation.
	 */
	async fetch(
		input: Parameters<typeof globalThis.fetch>[0],
		init?: RequestInit,
	): Promise<Response> {
		const sink = this.#sink
		if (sink === undefined) throw new StudyError('FAULT', 'Daemon journal is not open')
		await this.#finish()
		const request = new Request(input, {
			...init,
			signal: AbortSignal.any([
				this.#options.signal,
				...(init?.signal === undefined || init.signal === null ? [] : [init.signal]),
			]),
		})
		const first = this.#options.declaration.procedure[0]
		if (
			first === undefined ||
			new URL(request.url).pathname !== '/api/generate' ||
			request.method !== 'POST'
		)
			throw new StudyError('FAULT', 'Unexpected maintenance request')
		const identity: StudyExchangeIdentity = {
			ordinal: sink.next,
			goal: first.goal,
			role: 'maintenance',
			path: '/api/generate',
			method: 'POST',
			stage: 'maintenance',
		}
		await sink.append({
			...identity,
			phase: 'attempt',
			...buildStudyOllamaBytes(Buffer.from(await request.clone().arrayBuffer())),
		})
		const chunks: Uint8Array[] = []
		try {
			const response = await globalThis.fetch(request)
			const headers: ReadonlyArray<readonly [string, string]> = [...response.headers].filter(
				([name]) => name === 'content-type' || name === 'content-encoding',
			)
			const reader = response.body?.getReader()
			try {
				if (reader !== undefined)
					for (;;) {
						const step = await reader.read()
						if (step.done) break
						const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
						if (size + step.value.byteLength > this.#options.declaration.metadata.bytes)
							throw new StudyError(
								'CAPACITY',
								'Maintenance reply exceeds its declared byte allowance',
							)
						if (step.value.byteLength > 0) chunks.push(Buffer.from(step.value))
					}
			} finally {
				await reader?.cancel().catch(() => undefined)
				reader?.releaseLock()
			}
			const bytes = Buffer.concat(chunks)
			this.#pending.set(identity, {
				status: response.status,
				headers,
				chunks: chunks.map((chunk) => chunk.byteLength),
				...buildStudyOllamaBytes(bytes),
			})
			return new Response(response.body === null ? null : bytes, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			})
		} catch (error) {
			await sink.append({
				...identity,
				phase: 'failure',
				reason: error instanceof Error ? error.message : 'Maintenance request failed',
			})
			throw error
		}
	}

	async #finish(error?: unknown): Promise<void> {
		for (const [identity, reply] of this.#pending) {
			try {
				await this.#sink?.append(
					error === undefined
						? { ...identity, ...reply, phase: 'response' }
						: {
								...identity,
								phase: 'failure',
								reason: error instanceof Error ? error.message : 'Maintenance refused',
								response: reply,
							},
				)
			} finally {
				this.#pending.delete(identity)
			}
		}
	}
}
