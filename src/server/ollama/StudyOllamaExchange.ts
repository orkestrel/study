import type { OllamaTiming } from '@orkestrel/ollama'
import type { StudyOllamaTerminal, StudyOllamaWire } from './types.js'
import { StudyError } from '@src/core'

/** Tracks one owned HTTP response through its counted bytes, decoded rows, terminal and settlement. */
export class StudyOllamaExchange implements StudyOllamaWire {
	readonly activity: StudyOllamaWire['activity']
	readonly request: StudyOllamaWire['request']
	readonly ticket: StudyOllamaWire['ticket']
	readonly signal: StudyOllamaWire['signal']
	readonly reader: StudyOllamaWire['reader']
	readonly decoder: StudyOllamaWire['decoder']
	readonly status: StudyOllamaWire['status']
	readonly started: StudyOllamaWire['started']
	readonly id: StudyOllamaWire['id']
	readonly sent: StudyOllamaWire['sent']
	readonly dispatch: StudyOllamaWire['dispatch']
	#bytes: number
	#text = ''
	#terminal: StudyOllamaTerminal | undefined
	#timing: OllamaTiming | undefined
	#settled = false

	/** Binds the facts of one dispatched request and its open response.
	 * @param wire - The request, accounting boundary, reader and identities; its byte count starts the tally.
	 */
	constructor(
		wire: Pick<
			StudyOllamaWire,
			| 'activity'
			| 'request'
			| 'ticket'
			| 'signal'
			| 'reader'
			| 'decoder'
			| 'status'
			| 'started'
			| 'id'
			| 'sent'
			| 'dispatch'
			| 'bytes'
		>,
	) {
		this.activity = wire.activity
		this.request = wire.request
		this.ticket = wire.ticket
		this.signal = wire.signal
		this.reader = wire.reader
		this.decoder = wire.decoder
		this.status = wire.status
		this.started = wire.started
		this.id = wire.id
		this.sent = wire.sent
		this.dispatch = wire.dispatch
		this.#bytes = wire.bytes
	}

	/** Holds the encoded request bytes plus every response byte counted so far. */
	get bytes(): number {
		return this.#bytes
	}

	/** Holds the decoded response text not yet consumed as complete rows. */
	get text(): string {
		return this.#text
	}

	/** Holds the validated terminal row once observed. */
	get terminal(): StudyOllamaTerminal | undefined {
		return this.#terminal
	}

	/** Holds the daemon timing of the terminal row once observed. */
	get timing(): OllamaTiming | undefined {
		return this.#timing
	}

	/** Reports whether the request was accounted, finished or failed. */
	get settled(): boolean {
		return this.#settled
	}

	/** Adds a response chunk's bytes to the tally and refuses a tally beyond the allowance.
	 * @param length - The chunk's byte length.
	 * @param limit - The response byte allowance.
	 * @throws StudyError - Thrown with code `CAPACITY` and the request's role when the tally exceeds the allowance.
	 */
	count(length: number, limit: number): void {
		this.#bytes += length
		if (this.#bytes <= limit) return
		const message = 'Ollama wire byte allowance exceeded'
		throw new StudyError('CAPACITY', message, {
			cause: 'capacity',
			message,
			role: this.request.role,
			stop: { layer: 'scope', id: 'Wire bytes', max: limit, consumed: this.#bytes },
		})
	}

	/** Appends a chunk to the retained text through the strict decoder.
	 * @param chunk - The next response bytes.
	 * @throws TypeError - Thrown when the bytes are not valid UTF-8.
	 */
	decode(chunk: Uint8Array): void {
		this.#text += this.decoder.decode(chunk, { stream: true })
	}

	/** Appends what the strict decoder still holds after the last chunk.
	 * @throws TypeError - Thrown when the bytes ended inside a UTF-8 sequence.
	 */
	flush(): void {
		this.#text += this.decoder.decode()
	}

	/** Takes the complete lines of the retained text and keeps the unfinished tail.
	 * @param final - If `true`, the whole text is consumed and nothing is kept; if `false`, the last line is kept as an unfinished tail.
	 * @returns The lines in arrival order.
	 */
	take(final: boolean): readonly string[] {
		const lines = this.#text.split(/\r\n|\n/)
		this.#text = final ? '' : (lines.at(-1) ?? '')
		return final ? lines : lines.slice(0, -1)
	}

	/** Retains what a row read as its terminal and its daemon timing.
	 * @param terminal - The terminal the row validated as, or undefined when the row is not terminal.
	 * @param timing - The daemon timing of that row, or undefined when it is not observed.
	 */
	observe(terminal: StudyOllamaTerminal | undefined, timing: OllamaTiming | undefined): void {
		this.#terminal = terminal
		this.#timing = timing
	}

	/** Marks the request accounted, finished or failed. */
	settle(): void {
		this.#settled = true
	}
}
