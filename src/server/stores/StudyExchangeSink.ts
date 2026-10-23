import type {
	StudyExchangeRow,
	StudyExchangeSinkInterface,
	StudyExchangeSinkOptions,
} from './types.js'
import { StudyError } from '@src/core'
import { parseJSON } from '@orkestrel/contract'
import { validateStudyExchangeRows } from './helpers.js'
import { isStudyExchangeRow } from './validators.js'

/** Retains ordered exchange rows under a parent-reserved serialized byte allowance. */
export class StudyExchangeSink implements StudyExchangeSinkInterface {
	readonly #options: StudyExchangeSinkOptions
	readonly #writes = new Set<Promise<void>>()
	#rows: readonly StudyExchangeRow[] = []
	#bytes = 0
	#fault: { readonly error: unknown } | undefined
	#closing: Promise<void> | undefined

	/** Owns the descriptor and restores a verified prefix without rewriting it.
	 * @param options - The exclusive descriptor, byte bound and optional retained rows.
	 */
	constructor(options: StudyExchangeSinkOptions) {
		if (!Number.isSafeInteger(options.record.bytes) || options.record.bytes <= 0)
			throw new StudyError('CONFIG', 'Invalid exchange byte allowance')
		this.#options = { ...options, record: { ...options.record } }
		if (options.retained !== undefined) {
			const rows = structuredClone(options.retained)
			validateStudyExchangeRows(rows, false)
			this.#rows = rows
			this.#bytes = rows.reduce(
				(total, row) => total + Buffer.byteLength(JSON.stringify(row) + '\n'),
				0,
			)
			if (this.#bytes > this.#options.record.bytes)
				throw new StudyError('CAPACITY', 'Retained exchange prefix exceeds its allowance')
		}
	}

	/** Holds the next contiguous one-based HTTP ordinal, including the retained prefix. */
	get next(): number {
		return this.#rows.filter((row) => row.phase === 'attempt').length + 1
	}

	/** Appends one owned row after validating order and reserving its complete serialized size.
	 * @param row - The next declaration, attempt, terminal or completion.
	 * @returns Completion after synchronized retention; callers await each append before proceeding.
	 */
	append(row: StudyExchangeRow): Promise<void> {
		try {
			if (this.#closing !== undefined || this.#writes.size !== 0)
				throw new StudyError('CUSTODY', 'Exchange append requires drained open admission')
			const text = JSON.stringify(row) + '\n'
			const owned = parseJSON(text)
			if (!isStudyExchangeRow(owned)) throw new StudyError('CUSTODY', 'Invalid exchange row')
			if (this.#fault !== undefined && owned.phase !== 'failure') throw this.#fault.error
			const rows = [...this.#rows, owned]
			validateStudyExchangeRows(rows, false)
			const bytes = Buffer.from(text)
			const reservation =
				owned.phase === 'attempt'
					? Buffer.byteLength(
							JSON.stringify({
								...owned,
								phase: 'failure',
								reason: 'Exchange failed',
								body: undefined,
								digest: undefined,
								size: undefined,
							}) + '\n',
						) + 1024
					: 0
			if (this.#bytes + bytes.length + reservation > this.#options.record.bytes)
				throw new StudyError('CAPACITY', 'Serialized exchange bytes exceed the trial allowance')
			this.#rows = rows
			this.#bytes += bytes.length
			const pending = this.#write(bytes)
			this.#writes.add(pending)
			void pending.then(
				() => this.#writes.delete(pending),
				() => this.#writes.delete(pending),
			)
			return pending
		} catch (error) {
			this.#fault ??= { error }
			return Promise.reject(error)
		}
	}

	/** Closes admission, drains accepted writes and synchronizes the owned descriptor.
	 * @returns Completion after descriptor release, with a retained refusal propagated.
	 */
	close(): Promise<void> {
		this.#closing ??= Promise.allSettled([...this.#writes])
			.then(async () => {
				await this.#options.file.sync()
				if (this.#fault !== undefined) throw this.#fault.error
			})
			.finally(async () => {
				await this.#options.file.close()
			})
		return this.#closing
	}

	async #write(bytes: Uint8Array): Promise<void> {
		try {
			await this.#options.file.writeFile(bytes)
			await this.#options.file.sync()
		} catch (error) {
			this.#fault ??= { error }
			throw error
		}
	}
}
