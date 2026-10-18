import type { StudySessionInterface } from '../../core/types.js'
import type { StudyOperation } from './types.js'
import type { JSONValue } from '@orkestrel/contract'
import { isRecord } from '@orkestrel/contract'
import {
	StudyControl,
	StudyDeadline,
	failureToStudyError,
	readStudyFailure,
} from '../../core/engines/index.js'
import { StudyError } from '../../core/errors.js'
import { isStudyGoal, isStudyProduct, isStudyProfile } from '../../core/validators.js'
import { STUDY_PROCESS_LABEL } from './constants.js'
import { computeStudyProfileDigest, createStudyProcessFailure, toStudyWire } from './helpers.js'
import { StudyArtifacts } from './StudyArtifacts.js'
import { StudyChannel } from './StudyChannel.js'
import { StudyRemoteMeter } from './StudyRemoteMeter.js'
import { isStudyIdentity, isStudyProcessFailure, isStudyTrial } from './validators.js'

/** Executes one verified trial behind parent-authorized admission and custody. */
export class StudyWorker {
	#control = new StudyControl()
	#channel: StudyChannel | undefined
	#artifacts: StudyArtifacts | undefined
	#session: StudySessionInterface | undefined
	readonly #meters = new Set<StudyRemoteMeter>()
	#opening = false
	#closing = false
	#duration = 1000
	#executed = false
	#evidence = new Set<Promise<void>>()

	/** Serves the inherited IPC channel until its parent disconnects.
	 * @returns Completion after channel and acquired session cleanup.
	 */
	async execute(): Promise<void> {
		if (this.#executed || process.send === undefined || !process.connected)
			throw new StudyError('CONFIG', 'Study worker requires one inherited IPC channel')
		this.#executed = true
		this.#channel = new StudyChannel({
			endpoint: process,
			handle: (operation, value) => this.#handle(operation, value),
			abort: (value) => this.#abort(value),
		})
		try {
			await new Promise<void>((resolve) =>
				this.#channel?.signal.addEventListener('abort', () => resolve(), { once: true }),
			)
		} finally {
			this.#control.fail(createStudyProcessFailure('Study worker disconnected'))
			if (this.#session !== undefined)
				await new StudyDeadline({ duration: this.#duration, label: STUDY_PROCESS_LABEL })
					.wait(this.#session.close())
					.catch(() => undefined)
			this.#session = undefined
			this.#channel.close()
			this.#control.close()
		}
	}

	async #handle(operation: StudyOperation, value: JSONValue): Promise<JSONValue> {
		try {
			if (operation === 'open') return await this.#open(value)
			if (operation === 'goal') return await this.#goal(value)
			if (operation === 'close') {
				if (this.#closing) throw new StudyError('FAULT', 'Worker cleanup repeated')
				this.#closing = true
				this.#control.fail({
					cause: 'interrupted',
					message: 'Worker cleanup requested',
					role: undefined,
				})
				if (this.#session !== undefined)
					await new StudyDeadline({ duration: this.#duration, label: STUDY_PROCESS_LABEL }).wait(
						this.#session.close(),
					)
				this.#session = undefined
				this.#artifacts?.verify()
				return true
			}
			throw new StudyError('FAULT', 'Parent requested a forbidden worker operation')
		} catch (error) {
			this.#control.fail(readStudyFailure(error))
			throw error
		}
	}

	async #open(value: JSONValue): Promise<JSONValue> {
		if (this.#opening || this.#closing || this.#control.failure !== undefined)
			throw new StudyError('FAULT', 'Worker trial can open only once')
		this.#opening = true
		if (
			!isRecord(value) ||
			typeof value.entry !== 'string' ||
			typeof value.root !== 'string' ||
			typeof value.directory !== 'string' ||
			typeof value.driver !== 'string' ||
			typeof value.adapter !== 'string' ||
			!isStudyProfile(value.profile) ||
			!isStudyIdentity(value.identity) ||
			!isStudyTrial(value.trial)
		)
			throw new StudyError(
				'CONFIG',
				'Worker opening declaration is invalid or driver is unsupported',
			)
		this.#duration = value.profile.bounds.request.duration
		this.#artifacts = new StudyArtifacts({
			entry: value.entry,
			root: value.root,
			profile: value.profile,
			adapter: value.adapter,
		})
		const identity = await this.#artifacts.inspect()
		if (
			identity.agent !== value.identity.agent ||
			identity.subject !== value.identity.subject ||
			identity.provider !== value.identity.provider ||
			identity.instrument !== value.identity.instrument ||
			computeStudyProfileDigest(value.profile) !== value.identity.profile
		)
			throw new StudyError('FAULT', 'Worker artifact identity differs from parent declaration')
		const modules = await this.#artifacts.load()
		const adapter = await this.#artifacts.adapter()
		const driver = adapter.driver({
			...modules,
			profile: value.profile,
			directory: value.directory,
		})
		this.#session = await driver.open(value.trial, this.#control.signal)
		if (this.#control.failure !== undefined) throw failureToStudyError(this.#control.failure)
		return toStudyWire({ ...identity, pid: process.pid })
	}

	async #goal(value: JSONValue): Promise<JSONValue> {
		if (
			this.#session === undefined ||
			this.#channel === undefined ||
			this.#meters.size !== 0 ||
			this.#closing ||
			this.#control.failure !== undefined ||
			!isStudyGoal(value)
		)
			throw new StudyError('FAULT', 'Worker goal is invalid or out of order')
		const meter = new StudyRemoteMeter({ channel: this.#channel, control: this.#control })
		this.#meters.add(meter)
		try {
			const product = await this.#control.wait(
				this.#session.execute(value, {
					signal: this.#control.signal,
					meter,
					evidence: { append: (evidence) => this.#append(toStudyWire(evidence)) },
				}),
			)
			await meter.close()
			await Promise.all(this.#evidence)
			if (this.#control.failure !== undefined) throw failureToStudyError(this.#control.failure)
			if (!isStudyProduct(product))
				throw new StudyError('FAULT', 'Worker driver returned an invalid product')
			return toStudyWire(product)
		} finally {
			this.#meters.delete(meter)
		}
	}

	#append(value: JSONValue): Promise<void> {
		if (
			this.#channel === undefined ||
			this.#meters.size === 0 ||
			this.#control.failure !== undefined
		)
			return Promise.reject(new StudyError('FAULT', 'Worker evidence is outside an active goal'))
		const pending = this.#channel
			.request('evidence', value)
			.then((acknowledged) => {
				if (acknowledged !== true)
					throw new StudyError('FAULT', 'Worker evidence was not acknowledged')
			})
			.catch((error: unknown) => {
				this.#control.fail(readStudyFailure(error))
				throw error
			})
		this.#evidence.add(pending)
		void pending.then(
			() => this.#evidence.delete(pending),
			() => this.#evidence.delete(pending),
		)
		return pending
	}

	#abort(value: JSONValue): void {
		if (!isRecord(value) || !isStudyProcessFailure(value.failure))
			throw new StudyError('FAULT', 'Worker cancellation is malformed')
		if (value.id === undefined) this.#control.fail(value.failure)
		else {
			const [meter] = this.#meters
			if (typeof value.id !== 'number' || meter === undefined)
				throw new StudyError('FAULT', 'Worker ticket cancellation is foreign')
			meter.abort(value.id, value.failure)
		}
	}
}
