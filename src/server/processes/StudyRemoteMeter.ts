import type { StudyCharge, StudyFailure, StudyTicket, StudyUsage } from '@src/core'
import type { StudyRemoteMeterInterface, StudyRemoteMeterOptions } from './types.js'
import { failureToStudyError, readStudyFailure, StudyError, isStudyUsage } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { createStudyProcessFailure, valueToWire } from './helpers.js'
import { StudyRemoteTicket } from './StudyRemoteTicket.js'
import { isStudyProcessFailure } from './validators.js'

/** Waits for authoritative parent admission and drains acknowledged settlements. */
export class StudyRemoteMeter implements StudyRemoteMeterInterface {
	#options: StudyRemoteMeterOptions
	#next = 0
	#admissions = 0
	readonly #tickets = new Map<number, AbortController>()
	readonly #pending = new Set<Promise<void>>()
	#usage: StudyUsage[] = []
	#closed = false

	/** Owns one goal's transported tickets without local budget decisions.
	 * @param options - Parent transport and shared worker failure control, snapshotted at construction.
	 */
	constructor(options: StudyRemoteMeterOptions) {
		this.#options = { ...options }
	}
	get signal(): AbortSignal {
		return this.#options.control.signal
	}
	get usage(): readonly StudyUsage[] {
		return Object.freeze([...this.#usage])
	}

	/** Requests and awaits the parent's dispatch grant.
	 * @param charge - Upper bounds that the parent reserves before replying.
	 * @returns A ticket only after authoritative admission succeeds.
	 */
	async admit(charge: StudyCharge): Promise<StudyTicket> {
		if (this.#closed || this.#options.control.failure !== undefined)
			throw failureToStudyError(
				this.#options.control.failure ?? createStudyProcessFailure('Worker meter is closed'),
			)
		const id = ++this.#next
		this.#admissions++
		try {
			const response = await this.#options.control.wait(
				this.#options.channel.request('admit', valueToWire({ id, charge })),
			)
			if (!isRecord(response) || response.id !== id)
				throw new StudyError('FAULT', 'Worker admission grant is invalid')
			if (this.#closed) throw new StudyError('FAULT', 'Worker goal ended during admission')
			const controller = new AbortController()
			this.#tickets.set(id, controller)
			return new StudyRemoteTicket({
				id,
				signal: AbortSignal.any([controller.signal, this.signal]),
				settle: (operation, value) => this.#settle(id, operation, value),
			})
		} catch (error) {
			this.#options.control.fail(readStudyFailure(error))
			throw error
		} finally {
			this.#admissions--
		}
	}

	/** Propagates the parent's ticket cancellation without changing its cause.
	 * @param id - Parent-issued ticket identity.
	 * @param failure - Authoritative parent attribution.
	 */
	abort(id: number, failure: StudyFailure): void {
		const ticket = this.#tickets.get(id)
		if (ticket === undefined)
			throw new StudyError('FAULT', 'Cancellation names an unknown worker ticket')
		ticket.abort(failureToStudyError(failure))
		this.#options.control.fail(failure)
	}

	/** Closes admission and requires every ticket and acknowledgment to finish. */
	async close(): Promise<void> {
		this.#closed = true
		if (this.#tickets.size !== 0 || this.#admissions !== 0)
			this.#options.control.fail(
				createStudyProcessFailure('Worker goal ended with unfinished requests'),
			)
		await Promise.all(this.#pending)
		if (this.#options.control.failure !== undefined)
			throw failureToStudyError(this.#options.control.failure)
	}

	#settle(id: number, operation: 'finish' | 'fail', value: StudyUsage | StudyFailure): void {
		if (!this.#tickets.delete(id)) {
			this.#options.control.fail(
				createStudyProcessFailure('Worker ticket settlement is repeated or foreign'),
			)
			throw failureToStudyError(
				this.#options.control.failure ?? createStudyProcessFailure('Worker settlement failed'),
			)
		}
		const accepted = Object.freeze({ ...value })
		const work = this.#options.channel
			.request(
				operation,
				valueToWire(operation === 'finish' ? { id, usage: accepted } : { id, failure: accepted }),
			)
			.then(
				() => {
					if (operation === 'finish' && isStudyUsage(accepted)) this.#usage.push(accepted)
				},
				(error: unknown) => {
					this.#options.control.fail(readStudyFailure(error))
				},
			)
		this.#pending.add(work)
		void work.finally(() => this.#pending.delete(work))
		if (operation === 'fail' && isStudyProcessFailure(accepted))
			this.#options.control.fail(accepted)
	}
}
