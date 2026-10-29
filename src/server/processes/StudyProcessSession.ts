import type { StudyContext, StudyGoal, StudyProduct, StudySessionInterface } from '@src/core'
import type { StudyOperation, StudyParentTicket, StudyProcessSessionOptions } from './types.js'
import type { JSONValue } from '@orkestrel/contract'
import type { ChildProcess } from 'node:child_process'
import {
	StudyControl,
	StudyDeadline,
	failureToStudyError,
	readStudyFailure,
	StudyError,
	isStudyProduct,
	isStudyUsage,
} from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { execFile, fork } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { STUDY_LOG_BYTES, STUDY_PROCESS_LABEL, STUDY_WORKER_OPERATION } from './constants.js'
import {
	createStudyProcessFailure,
	drainStudyChild,
	valueToWire,
	validateStudyCaptureDeclaration,
} from './helpers.js'
import { StudyChannel } from './StudyChannel.js'
import { StudyProcessGoal } from './StudyProcessGoal.js'
import {
	isStudyCharge,
	isStudyEvidence,
	isStudyExchangeDestination,
	isStudyProcessFailure,
} from './validators.js'

/** Keeps admission and evidence custody in the parent of one fresh trial process. */
export class StudyProcessSession implements StudySessionInterface {
	#options: StudyProcessSessionOptions
	#control: StudyControl
	#listeners = new AbortController()
	#child: ChildProcess | undefined
	#channel: StudyChannel | undefined
	#exit: Promise<void> | undefined
	#closing: Promise<void> | undefined
	readonly #goals = new Set<StudyProcessGoal>()
	readonly #tickets = new Map<number, StudyParentTicket>()
	readonly #appends = new Set<Promise<void>>()
	#logs = 0
	#started = false
	#deadline: ReturnType<typeof setTimeout> | undefined

	/** Owns one trial's process lifecycle without starting host work.
	 * @param options - Public trial and process configuration; the configuration is snapshotted while the borrowed signal keeps its identity.
	 */
	constructor(options: StudyProcessSessionOptions) {
		const { signal, ...configuration } = options
		this.#options = { ...structuredClone(configuration), signal }
		this.#control = new StudyControl(signal)
	}

	/** Starts the child and verifies its artifact-bound readiness. */
	async start(): Promise<void> {
		if (this.#started || this.#closing !== undefined)
			throw new StudyError('FAULT', 'Study process start is single use')
		this.#started = true
		if (this.#control.failure !== undefined) throw failureToStudyError(this.#control.failure)
		if (![this.#options.entry, this.#options.root, this.#options.directory].every(isAbsolute))
			throw new StudyError('CONFIG', 'Study process paths must be absolute')
		const destination = this.#options.exchanges?.[this.#options.trial.id]
		if (
			this.#options.profile.record === undefined
				? destination !== undefined
				: !isStudyExchangeDestination(destination)
		)
			throw new StudyError('CONFIG', 'Session recording differs from its reserved allowance')
		if (destination !== undefined)
			validateStudyCaptureDeclaration(
				destination.declaration,
				this.#options.profile,
				this.#options.trial,
			)
		const directory = await mkdtemp(join(this.#options.directory, 'trial-'))
		if (this.#control.failure !== undefined) throw failureToStudyError(this.#control.failure)
		const child = fork(this.#options.entry, [STUDY_WORKER_OPERATION], {
			cwd: this.#options.root,
			execArgv: [...process.execArgv],
			silent: true,
			serialization: 'json',
			windowsHide: true,
			detached: process.platform !== 'win32',
		})
		drainStudyChild(child)
		this.#child = child
		this.#deadline = setTimeout(() => {
			this.#control.fail({
				cause: 'deadline',
				message: 'Trial native deadline exceeded',
				role: undefined,
				// The session holds no start time, so the timer firing proves only that the elapsed time reached the limit.
				stop: {
					layer: 'scope',
					id: 'Trial duration',
					max: this.#options.profile.bounds.trial.duration,
					consumed: undefined,
				},
			})
			void this.#terminate().catch((error: unknown) => this.#control.fail(readStudyFailure(error)))
		}, this.#options.profile.bounds.trial.duration)
		this.#exit = new Promise<void>((resolve) => child.once('close', () => resolve()))
		this.#channel = new StudyChannel({
			endpoint: child,
			handle: (operation, value) =>
				this.#handle(operation, value).catch((error: unknown) => {
					this.#control.fail(readStudyFailure(error))
					throw error
				}),
			abort: () => {
				throw new StudyError('FAULT', 'Worker cannot cancel parent authority')
			},
		})
		this.#channel.signal.addEventListener(
			'abort',
			() => this.#control.fail(readStudyFailure(this.#channel?.signal.reason)),
			{ once: true, signal: this.#listeners.signal },
		)
		this.#control.signal.addEventListener(
			'abort',
			() => this.#channel?.abort(valueToWire({ failure: this.#control.failure })),
			{ once: true, signal: this.#listeners.signal },
		)
		child.stdout?.on('data', (value: Buffer) => this.#readLog(value))
		child.stderr?.on('data', (value: Buffer) => this.#readLog(value))
		const ready = await this.#control.wait(
			new StudyDeadline({
				duration: this.#options.profile.bounds.trial.duration,
				label: STUDY_PROCESS_LABEL,
			}).wait(
				this.#channel.request(
					'open',
					valueToWire({ ...this.#options, signal: undefined, directory }),
				),
			),
		)
		if (
			!isRecord(ready) ||
			ready.pid !== child.pid ||
			ready.agent !== this.#options.identity.agent ||
			ready.runtime !== this.#options.identity.runtime ||
			ready.content !== this.#options.identity.content ||
			ready.subject !== this.#options.identity.subject ||
			ready.instrument !== this.#options.identity.instrument
		)
			throw new StudyError('FAULT', 'Worker readiness identity differs')
	}

	/** Runs one ordered goal through parent-authorized requests and acknowledged evidence.
	 * @param goal - Public goal without grading truth.
	 * @param context - Actual parent meter and evidence sink.
	 * @returns The retained child product after every admitted operation settles.
	 */
	async execute(goal: StudyGoal, context: StudyContext): Promise<StudyProduct> {
		if (this.#goals.size !== 0 || this.#closing !== undefined || this.#channel === undefined)
			throw new StudyError('FAULT', 'Study process cannot execute in its current state')
		if (this.#control.failure !== undefined) throw failureToStudyError(this.#control.failure)
		const running = new StudyProcessGoal(context)
		this.#goals.add(running)
		const listeners = new AbortController()
		const control = new StudyControl(context.signal)
		this.#control.signal.addEventListener(
			'abort',
			() =>
				control.fail(this.#control.failure ?? createStudyProcessFailure('Study process failed')),
			{ once: true, signal: listeners.signal },
		)
		control.signal.addEventListener(
			'abort',
			() => this.#channel?.abort(valueToWire({ failure: control.failure })),
			{ once: true, signal: listeners.signal },
		)
		try {
			const product = await control.wait(this.#channel.request('goal', valueToWire(goal)))
			if (this.#tickets.size !== 0 || this.#appends.size !== 0)
				throw new StudyError('FAULT', 'Worker goal ended with unsettled admission or evidence')
			if (!isStudyProduct(product)) throw new StudyError('FAULT', 'Worker product is invalid')
			return product
		} catch (error) {
			this.#control.fail(readStudyFailure(error))
			throw failureToStudyError(this.#control.failure ?? readStudyFailure(error))
		} finally {
			listeners.abort()
			control.close()
			this.#goals.delete(running)
		}
	}

	/** Requests verified cleanup, then terminates only this recorded process tree. */
	close(): Promise<void> {
		this.#closing ??= this.#close()
		return this.#closing
	}

	async #handle(operation: StudyOperation, value: JSONValue): Promise<JSONValue> {
		const [running] = this.#goals
		if (running === undefined) throw new StudyError('FAULT', 'Worker requested work outside a goal')
		const context = running.context
		if (operation === 'admit') {
			if (!isRecord(value) || !isStudyCharge(value.charge))
				throw new StudyError('FAULT', 'Invalid worker admission')
			const id = running.issue(value.id)
			if (id === undefined) throw new StudyError('FAULT', 'Invalid worker admission')
			const ticket = await context.meter.admit(value.charge)
			const listeners = new AbortController()
			this.#tickets.set(id, { ticket, listeners })
			ticket.signal.addEventListener(
				'abort',
				() =>
					this.#channel?.abort(
						valueToWire({ id, failure: readStudyFailure(ticket.signal.reason) }),
					),
				{ once: true, signal: listeners.signal },
			)
			if (ticket.signal.aborted) throw ticket.signal.reason
			return { id }
		}
		if (operation === 'finish' || operation === 'fail') {
			if (!isRecord(value) || typeof value.id !== 'number')
				throw new StudyError('FAULT', 'Invalid worker settlement')
			const entry = this.#tickets.get(value.id)
			if (entry === undefined)
				throw new StudyError('FAULT', 'Foreign or repeated worker settlement')
			if (
				(operation === 'finish' && !isStudyUsage(value.usage)) ||
				(operation === 'fail' && !isStudyProcessFailure(value.failure))
			)
				throw new StudyError('FAULT', 'Invalid worker settlement payload')
			this.#tickets.delete(value.id)
			entry.listeners.abort()
			if (operation === 'finish' && isStudyUsage(value.usage)) entry.ticket.finish(value.usage)
			else if (isStudyProcessFailure(value.failure)) entry.ticket.fail(value.failure)
			return true
		}
		if (operation === 'evidence') {
			if (!isStudyEvidence(value)) throw new StudyError('FAULT', 'Invalid worker evidence')
			const appending = context.evidence.append(value)
			this.#appends.add(appending)
			try {
				await appending
				return true
			} finally {
				this.#appends.delete(appending)
			}
		}
		throw new StudyError('FAULT', 'Worker requested a forbidden operation')
	}

	#readLog(value: Buffer): void {
		this.#logs += value.byteLength
		if (this.#logs > STUDY_LOG_BYTES) {
			this.#control.fail(createStudyProcessFailure('Worker output limit exceeded'))
			void this.close().catch(() => undefined)
		}
	}

	async #close(): Promise<void> {
		const failure = await this.#acknowledge()
		for (const entry of this.#tickets.values()) {
			entry.listeners.abort()
			if (!entry.ticket.signal.aborted) {
				try {
					entry.ticket.fail(
						this.#control.failure ??
							createStudyProcessFailure('Worker closed with an unfinished request'),
					)
				} catch {
					/* First parent failure is already retained. */
				}
			}
		}
		this.#tickets.clear()
		this.#listeners.abort()
		this.#channel?.close(failure)
		await this.#terminate()
		this.#control.close()
		if (failure !== undefined) throw failure
	}

	// Asks the worker to clean up and returns the failure that stopped it, or undefined when it acknowledged.
	async #acknowledge(): Promise<unknown> {
		try {
			if (this.#channel !== undefined && !this.#channel.signal.aborted) {
				const closed = await new StudyDeadline({
					duration: this.#options.profile.bounds.request.duration,
					label: STUDY_PROCESS_LABEL,
				}).wait(this.#channel.request('close', true))
				if (closed !== true)
					throw new StudyError('FAULT', 'Worker cleanup acknowledgment is invalid')
			}
			return undefined
		} catch (error) {
			return error
		}
	}

	async #terminate(): Promise<void> {
		clearTimeout(this.#deadline)
		const child = this.#child
		if (child === undefined) return
		if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
			if (process.platform === 'win32') {
				await new Promise<void>((resolve, reject) =>
					execFile(
						'taskkill',
						['/PID', String(child.pid), '/T', '/F'],
						{ windowsHide: true, timeout: 2000 },
						(error) =>
							error === null || child.exitCode !== null || child.signalCode !== null
								? resolve()
								: reject(error),
					),
				)
			} else process.kill(-child.pid, 'SIGKILL')
		}
		if (this.#exit !== undefined)
			await new StudyDeadline({ duration: 2000, label: STUDY_PROCESS_LABEL }).wait(this.#exit)
	}
}
