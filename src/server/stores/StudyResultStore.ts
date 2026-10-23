import type { StudyAttempt, StudyManifest, StudySinkInterface, StudyTrial } from '@src/core'
import type {
	StudyCustodyPhase,
	StudyExchangeDestination,
	StudyExchangeDeclaration,
	StudyResultStoreOptions,
	StudyResultStoreInterface,
	StudySeal,
	StudyTrialCustody,
} from './types.js'
import { StudyError } from '@src/core'
import { canonicalStringify } from '@orkestrel/contract'
import { mkdir, open } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { decodeStudyJSON, encodeStudyJSON } from '../helpers.js'
import { STUDY_CUSTODY_BYTES } from './constants.js'
import {
	checkStudyDirectory,
	computeStudySealId,
	readStudyBytes,
	readStudyResult,
	readStudyTrialExchanges,
	scanStudyExecution,
	validateStudyEvidenceBytes,
	writeStudyBytes,
} from './helpers.js'
import { StudyEvidenceSink } from './StudyEvidenceSink.js'
import {
	isStudyCustodyAttempt,
	isStudyCustodyManifest,
	isStudyCustodyTrial,
	isStudyExchangeDeclaration,
} from './validators.js'

/** Owns append-only execution bytes and seals only a complete terminal population. */
export class StudyResultStore implements StudyResultStoreInterface {
	readonly #directory: string
	readonly #manifest: StudyManifest
	readonly #trials = new Map<string, StudyTrialCustody>()
	readonly #starting = new Set<string>()
	readonly #exchanges = new Map<string, StudyExchangeDestination>()
	#phase: StudyCustodyPhase = 'new'
	#bytes = 0

	/**
	 * Owns a validated manifest snapshot without creating any files.
	 * @param options - The new result directory and execution declaration
	 * @throws StudyError - Thrown when the manifest is invalid
	 */
	constructor(options: StudyResultStoreOptions) {
		if (!isStudyCustodyManifest(options.manifest))
			throw new StudyError('CONFIG', 'Invalid execution manifest')
		const snapshot = decodeStudyJSON(encodeStudyJSON(options.manifest))
		if (!isStudyCustodyManifest(snapshot))
			throw new StudyError('CONFIG', 'Invalid manifest snapshot')
		this.#manifest = snapshot
		this.#directory = resolve(options.directory)
	}

	/**
	 * Exclusively creates the result directory and initial manifest bytes.
	 * @returns Nothing after the manifest is synchronized
	 * @throws StudyError - Thrown when creation repeats or custody bounds are exceeded
	 */
	async create(): Promise<void> {
		if (this.#phase !== 'new') throw new StudyError('CUSTODY', 'Result creation has already begun')
		this.#phase = 'creating'
		try {
			const bytes = encodeStudyJSON(this.#manifest)
			if (bytes.byteLength > STUDY_CUSTODY_BYTES)
				throw new StudyError('CAPACITY', 'Manifest exceeds the metadata allowance')
			this.#reserve(bytes.byteLength)
			await checkStudyDirectory(dirname(this.#directory))
			await mkdir(this.#directory)
			await mkdir(join(this.#directory, 'execution'))
			await mkdir(join(this.#directory, 'execution', 'trials'))
			await writeStudyBytes(join(this.#directory, 'execution', 'manifest.json'), bytes)
			this.#phase = 'ready'
		} catch (error) {
			this.#phase = 'failed'
			throw error
		}
	}

	/** Reserves a trial's entire exchange allowance before any worker starts.
	 * @param trial - The exact scheduled trial whose manifest declares recording.
	 * @param declaration - The parent's single opening row, joined to the manifest's horizon and bounds.
	 * @returns Its exclusive sidecar destination, without creating the trial directory.
	 */
	async exchanges(
		trial: StudyTrial,
		declaration: StudyExchangeDeclaration,
	): Promise<StudyExchangeDestination> {
		const scheduled = this.#manifest.schedule.find((entry) => entry.id === trial.id)
		const scenario = this.#manifest.scenarios.find((entry) => entry.id === trial.scenario)
		if (
			this.#phase !== 'ready' ||
			!isStudyCustodyTrial(trial) ||
			scheduled === undefined ||
			this.#manifest.record === undefined ||
			!isStudyExchangeDeclaration(declaration) ||
			declaration.trial !== trial.id ||
			canonicalStringify(declaration.record) !== canonicalStringify(this.#manifest.record) ||
			canonicalStringify(declaration.goals) !==
				canonicalStringify(scenario?.goals.map((goal) => goal.id)) ||
			canonicalStringify(scheduled) !== canonicalStringify(trial) ||
			this.#exchanges.has(trial.id) ||
			this.#trials.has(trial.id) ||
			this.#starting.has(trial.id)
		)
			throw new StudyError('CUSTODY', 'Trial sidecar cannot be reserved')
		this.#reserve(this.#manifest.record.bytes)
		const destination = Object.freeze({
			path: join(this.#directory, 'execution', 'trials', scheduled.id, 'exchanges.jsonl'),
			declaration: structuredClone(declaration),
		})
		this.#exchanges.set(scheduled.id, destination)
		return destination
	}

	/**
	 * Exclusively creates the evidence sink for an exact scheduled trial.
	 * @param trial - The scheduled trajectory
	 * @returns The bounded append-only sink
	 * @throws StudyError - Thrown when the trial is foreign, repeated, or late
	 */
	async start(trial: StudyTrial): Promise<StudySinkInterface> {
		if (
			this.#phase !== 'ready' ||
			!isStudyCustodyTrial(trial) ||
			this.#trials.has(trial.id) ||
			this.#starting.has(trial.id)
		)
			throw new StudyError('CUSTODY', 'Trial cannot start in the current state')
		const scheduled = this.#manifest.schedule.find((entry) => entry.id === trial.id)
		const scenario = this.#manifest.scenarios.find((entry) => entry.id === trial.scenario)
		if (
			scheduled === undefined ||
			scenario === undefined ||
			(this.#manifest.record !== undefined && !this.#exchanges.has(trial.id)) ||
			canonicalStringify(scheduled) !== canonicalStringify(trial)
		)
			throw new StudyError('CUSTODY', 'Trial differs from the execution schedule')
		this.#starting.add(scheduled.id)
		try {
			const directory = join(this.#directory, 'execution', 'trials', scheduled.id)
			await checkStudyDirectory(dirname(directory))
			await mkdir(directory)
			const file = await open(join(directory, 'evidence.jsonl'), 'wx')
			const sink = new StudyEvidenceSink({
				file,
				goals: scenario.goals.map((goal) => goal.id),
				goal: this.#manifest.bounds.goal.bytes,
				trial: this.#manifest.bounds.trial.bytes,
				budget: { reserve: (bytes) => this.#reserve(bytes) },
			})
			this.#trials.set(scheduled.id, { sink, terminal: undefined })
			return sink
		} catch (error) {
			this.#phase = 'failed'
			throw error
		} finally {
			this.#starting.delete(scheduled.id)
		}
	}

	/**
	 * Closes evidence admission, drains admitted appends, and writes a terminal record.
	 * @param attempt - The complete scheduled goal horizon
	 * @returns Nothing after the terminal record is synchronized
	 * @throws StudyError - Thrown when the terminal record is invalid, repeated, or late
	 */
	finish(attempt: StudyAttempt): Promise<void> {
		try {
			if (this.#phase !== 'ready' || !isStudyCustodyAttempt(attempt, this.#manifest))
				throw new StudyError('CUSTODY', 'Attempt differs from the declared horizon')
			const custody = this.#trials.get(attempt.trial.id)
			if (custody === undefined || custody.terminal !== undefined)
				throw new StudyError('CUSTODY', 'Trial is unknown or already terminal')
			const bytes = encodeStudyJSON(attempt)
			if (bytes.byteLength > STUDY_CUSTODY_BYTES)
				throw new StudyError('CAPACITY', 'Attempt exceeds the metadata allowance')
			const drained = custody.sink.close()
			const terminal = this.#finish(attempt.trial.id, bytes, drained)
			this.#trials.set(attempt.trial.id, { ...custody, terminal })
			return terminal
		} catch (error) {
			return Promise.reject(error)
		}
	}

	/**
	 * Seals exact execution inventory after every scheduled trial has terminated.
	 * @returns The immutable deterministic execution seal
	 * @throws StudyError - Thrown when custody is incomplete, invalid, or already sealed
	 */
	async seal(): Promise<StudySeal> {
		if (
			this.#phase !== 'ready' ||
			this.#starting.size !== 0 ||
			this.#trials.size !== this.#manifest.schedule.length ||
			[...this.#trials.values()].some((trial) => trial.terminal === undefined)
		)
			throw new StudyError('CUSTODY', 'Execution is not terminally accounted')
		this.#phase = 'sealing'
		try {
			await Promise.all([...this.#trials.values()].map((trial) => trial.terminal))
			const reading = await readStudyResult(this.#directory)
			if (
				reading.status !== 'interrupted' ||
				reading.manifest === undefined ||
				reading.attempts.length !== this.#manifest.schedule.length ||
				canonicalStringify(reading.manifest) !== canonicalStringify(this.#manifest)
			)
				throw new StudyError('CUSTODY', 'Execution changed before sealing')
			const files = await scanStudyExecution(join(this.#directory, 'execution'), this.#manifest)
			if (
				files.length !==
				1 + this.#manifest.schedule.length * (this.#manifest.record === undefined ? 2 : 3)
			)
				throw new StudyError('CUSTODY', 'Execution inventory is incomplete')
			for (const trial of this.#manifest.schedule) {
				if (this.#manifest.record !== undefined) {
					const file = files.find((entry) => entry.path === `trials/${trial.id}/exchanges.jsonl`)
					if (file === undefined || !this.#exchanges.has(trial.id))
						throw new StudyError('CUSTODY', 'Recorded trial has no reserved complete sidecar')
					await readStudyTrialExchanges(this.#directory, this.#manifest, trial.id, file)
				}
				validateStudyEvidenceBytes(
					await readStudyBytes(
						join(this.#directory, 'execution', 'trials', trial.id, 'evidence.jsonl'),
						this.#manifest.bounds.trial.bytes,
					),
					this.#manifest,
					trial.id,
				)
			}
			const seal: StudySeal = Object.freeze({
				result: this.#manifest.id,
				id: computeStudySealId(this.#manifest.id, files),
				files,
			})
			const bytes = encodeStudyJSON(seal)
			if (bytes.byteLength > STUDY_CUSTODY_BYTES)
				throw new StudyError('CAPACITY', 'Seal exceeds the metadata allowance')
			if (
				files.reduce((total, file) => total + file.bytes, bytes.byteLength) >
				this.#manifest.bounds.series.bytes
			)
				throw new StudyError('CAPACITY', 'Seal and execution exceed the series allowance')
			this.#reserve(bytes.byteLength)
			await writeStudyBytes(join(this.#directory, 'seal.json'), bytes)
			const verified = await readStudyResult(this.#directory)
			if (verified.status !== 'sealed' || verified.seal.id !== seal.id)
				throw new StudyError('CUSTODY', 'Execution changed while sealing')
			this.#phase = 'sealed'
			return seal
		} catch (error) {
			this.#phase = 'failed'
			throw error
		}
	}

	#reserve(bytes: number): void {
		if (this.#bytes + bytes > this.#manifest.bounds.series.bytes)
			throw new StudyError('CAPACITY', 'Execution bytes exceed the series allowance')
		this.#bytes += bytes
	}

	async #finish(trial: string, bytes: Uint8Array, drained: Promise<void>): Promise<void> {
		try {
			await drained
			this.#reserve(bytes.byteLength)
			await writeStudyBytes(
				join(this.#directory, 'execution', 'trials', trial, 'attempt.json'),
				bytes,
			)
		} catch (error) {
			this.#phase = 'failed'
			throw error
		}
	}
}
