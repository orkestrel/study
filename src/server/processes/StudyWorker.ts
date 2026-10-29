import type { StudyRole, StudySessionInterface } from '@src/core'
import type { StudyOperation } from './types.js'
import type {
	StudyExchangeSinkInterface,
	StudyExchangeRow,
	StudyExchangeAttempt,
} from '../stores/types.js'
import type { StudyOllamaReplayInterface } from '../ollama/types.js'
import type { JSONValue } from '@orkestrel/contract'
import {
	StudyControl,
	StudyDeadline,
	failureToStudyError,
	readStudyFailure,
	StudyError,
	isStudyGoal,
	isStudyProduct,
	isStudyProfile,
} from '@src/core'
import { canonicalStringify, isRecord } from '@orkestrel/contract'
import { open } from 'node:fs/promises'
import { STUDY_PROCESS_LABEL } from './constants.js'
import {
	computeStudyProfileDigest,
	createStudyProcessFailure,
	validateStudyCaptureDeclaration,
	readStudyReplayHistory,
	valueToWire,
} from './helpers.js'
import { readStudyBytes, readStudyExchangeRows } from '../stores/helpers.js'
import { hashStudyBytes } from '../helpers.js'
import { StudyExchangeSink } from '../stores/StudyExchangeSink.js'
import { StudyOllamaReplay } from '../ollama/StudyOllamaReplay.js'
import { describeStudyReplayDifference } from '../ollama/helpers.js'
import { isStudyClosure } from '../commands/validators.js'
import { StudyArtifactLoader } from './StudyArtifactLoader.js'
import { StudyChannel } from './StudyChannel.js'
import { StudyRemoteMeter } from './StudyRemoteMeter.js'
import {
	isStudyExchangeDestination,
	isStudyReplaySelection,
	isStudyIdentity,
	isStudyProcessFailure,
	isStudyTrial,
} from './validators.js'

/** Executes one verified trial behind parent-authorized admission and custody. */
export class StudyWorker {
	#control = new StudyControl()
	#channel: StudyChannel | undefined
	#artifacts: StudyArtifactLoader | undefined
	#session: StudySessionInterface | undefined
	readonly #meters = new Set<StudyRemoteMeter>()
	#opening = false
	#closing = false
	#duration = 1000
	#executed = false
	#exchanges: StudyExchangeSinkInterface | undefined
	#replay: StudyOllamaReplayInterface | undefined
	#boundary: StudyExchangeAttempt | undefined
	#continued = false
	#maintenance: readonly StudyExchangeRow[] = []
	readonly #evidence = new Set<Promise<void>>()

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
			await Promise.allSettled([this.#exchanges?.close(), this.#replay?.close()])
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
				if (this.#meters.size !== 0 || this.#control.failure !== undefined)
					this.#control.fail({
						cause: 'interrupted',
						message: 'Worker cleanup requested',
						role: undefined,
						stop: undefined,
					})
				if (this.#session !== undefined)
					await new StudyDeadline({ duration: this.#duration, label: STUDY_PROCESS_LABEL }).wait(
						this.#session.close(),
					)
				this.#session = undefined
				try {
					this.#replay?.check()
				} finally {
					await this.#replay?.close()
					await this.#exchanges?.close()
				}
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
		if (value.closure !== undefined && !isStudyClosure(value.closure))
			throw new StudyError('CONFIG', 'Worker closure selection is malformed')
		const destination = isRecord(value.exchanges) ? value.exchanges[value.trial.id] : undefined
		if (destination !== undefined) {
			if (!isStudyExchangeDestination(destination))
				throw new StudyError('CONFIG', 'Invalid worker exchange destination')
			validateStudyCaptureDeclaration(destination.declaration, value.profile, value.trial)
		}
		if (value.replay !== undefined) {
			if (!isStudyReplaySelection(value.replay) || value.profile.provider === undefined)
				throw new StudyError('CONFIG', 'Worker replay selection is invalid')
			if (!isStudyExchangeDestination(destination))
				throw new StudyError('CONFIG', 'Replay requires a declaration')
			const history = await readStudyReplayHistory(
				value.replay,
				value.profile,
				value.trial,
				destination.declaration,
			)
			const prefix = value.replay.prefix[value.trial.id]
			if (prefix === undefined) throw new StudyError('CONFIG', 'Worker replay prefix is absent')
			if (destination.declaration.ancestor?.identity.runtime !== value.identity.runtime)
				throw new StudyError('CONFIG', 'Worker replay runtime differs from its ancestor')
			if (destination.declaration.goals.length > history.declaration.goals.length) {
				if (
					value.replay.offline ||
					destination.declaration.ancestor?.identity.content !== value.identity.content ||
					history.exchanges[prefix]?.attempt.stage !== 'postflight'
				)
					throw new StudyError('CONFIG', 'Worker continuation identity or boundary changed')
				this.#boundary = history.exchanges[prefix]?.attempt
			}
			this.#replay = new StudyOllamaReplay({
				history,
				prefix,
				url: value.profile.provider.url,
				limit: {
					calls: destination.declaration.record.calls + destination.declaration.metadata.calls,
					bytes: destination.declaration.record.bytes,
					duration: value.profile.bounds.trial.duration,
				},
				signal: this.#control.signal,
				...(value.replay.offline ? {} : { fetch: this.#forward.bind(this) }),
			})
		}
		if (value.profile.record === undefined && destination !== undefined)
			throw new StudyError('CONFIG', 'Unrecorded worker received a sidecar')
		if (value.profile.record !== undefined) {
			if (!isStudyExchangeDestination(destination))
				throw new StudyError('CONFIG', 'Recorded worker has no matching reserved sidecar')
			const declaration = destination.declaration
			const retained =
				destination.retained === undefined
					? undefined
					: await readStudyBytes(destination.path, declaration.record.bytes)
			if (
				retained !== undefined &&
				(hashStudyBytes(retained) !== destination.retained?.digest ||
					retained.length !== destination.retained.bytes ||
					destination.retained.path !== `trials/${value.trial.id}/exchanges.jsonl`)
			)
				throw new StudyError('CUSTODY', 'Maintenance prefix changed before worker opening')
			const rows = retained === undefined ? undefined : readStudyExchangeRows(retained, false)
			if (
				rows !== undefined &&
				(rows[0]?.phase !== 'declaration' ||
					rows[0].trial !== value.trial.id ||
					rows.some(
						(row) =>
							row.phase !== 'declaration' &&
							((row.phase !== 'attempt' && row.phase !== 'response') ||
								row.stage !== 'maintenance'),
					) ||
					rows.at(-1)?.phase !== 'response')
			)
				throw new StudyError('CUSTODY', 'Retained prefix is not completed maintenance')
			if (rows !== undefined && rows[0]?.phase === 'declaration') {
				if (
					canonicalStringify(rows[0]) !== canonicalStringify(declaration) ||
					rows.filter((row) => row.phase === 'response').length !== rows[0].maintenance.length
				)
					throw new StudyError(
						'CUSTODY',
						'Retained maintenance declaration differs from the executing profile',
					)
			}
			const file = await open(destination.path, rows === undefined ? 'wx' : 'a')
			try {
				this.#exchanges = new StudyExchangeSink({
					file,
					record: declaration.record,
					...(rows === undefined ? {} : { retained: rows }),
				})
			} catch (error) {
				await file.close()
				throw error
			}
			if (rows === undefined) await this.#exchanges.append(declaration)
			else this.#maintenance = rows
		}
		this.#artifacts = new StudyArtifactLoader({
			entry: value.entry,
			root: value.root,
			profile: value.profile,
			adapter: value.adapter,
			...(value.closure === undefined ? {} : { closure: value.closure }),
		})
		const identity = await this.#artifacts.inspect()
		if (
			identity.agent !== value.identity.agent ||
			identity.runtime !== value.identity.runtime ||
			identity.content !== value.identity.content ||
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
			...(this.#exchanges === undefined ? {} : { exchanges: this.#exchanges }),
			...(this.#replay === undefined ? {} : { replay: this.#replay }),
		})
		this.#session = await driver.open(value.trial, this.#control.signal)
		if (this.#control.failure !== undefined) throw failureToStudyError(this.#control.failure)
		return valueToWire({ ...identity, pid: process.pid })
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
			for (const row of this.#maintenance) {
				if (row.phase === 'attempt' || row.phase === 'response')
					await this.#append(
						valueToWire({
							event: row.phase === 'attempt' ? 'dispatch' : 'wire',
							goal: value.id,
							value: { ordinal: row.ordinal, role: row.role, path: row.path },
						}),
					)
			}
			this.#maintenance = []
			const product = await this.#control.wait(
				this.#session.execute(value, {
					signal: this.#control.signal,
					meter,
					evidence: { append: (evidence) => this.#append(valueToWire(evidence)) },
				}),
			)
			await meter.close()
			await Promise.all(this.#evidence)
			if (this.#control.failure !== undefined) throw failureToStudyError(this.#control.failure)
			if (!isStudyProduct(product))
				throw new StudyError('FAULT', 'Worker driver returned an invalid product')
			if (this.#boundary?.goal === value.id) {
				this.#replay?.check()
				this.#continued = true
			}
			return valueToWire(product)
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

	async #forward(role: StudyRole, input: string | URL, init: RequestInit): Promise<Response> {
		if (this.#boundary !== undefined && !this.#continued) {
			const request = new Request(input, init)
			throw new StudyError(
				'FAULT',
				describeStudyReplayDifference(this.#boundary, {
					ordinal: this.#boundary.ordinal,
					role,
					path: new URL(input).pathname,
					method: request.method,
					body: new Uint8Array(await request.arrayBuffer()),
				}) ?? 'Continuation request precedes the end of the recorded goals',
			)
		}
		return globalThis.fetch(input, {
			...init,
			signal: AbortSignal.any([
				this.#control.signal,
				...(init.signal === undefined || init.signal === null ? [] : [init.signal]),
			]),
		})
	}
}
