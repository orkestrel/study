import type {
	StudyAttempt,
	StudyManifest,
	StudySinkInterface,
	StudyTrial,
} from '../../core/types.js'
import type {
	StudyCustodyPhase,
	StudyResultOptions,
	StudyResultsInterface,
	StudySeal,
	StudyTrialCustody,
} from './types.js'
import { canonicalStringify } from '@orkestrel/contract'
import { mkdir, open } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { StudyError } from '../../core/errors.js'
import { decodeStudyJSON, encodeStudyJSON } from '../helpers.js'
import { STUDY_CUSTODY_BYTES } from './constants.js'
import {
	checkStudyDirectory,
	computeStudySealId,
	readStudyBytes,
	readStudyResult,
	scanStudyExecution,
	validateStudyEvidenceBytes,
	writeStudyBytes,
} from './helpers.js'
import { StudyEvidenceSink } from './StudyEvidenceSink.js'
import { isStudyCustodyAttempt, isStudyCustodyManifest, isStudyCustodyTrial } from './validators.js'

/** Owns append-only execution bytes and seals only a complete terminal population. */
export class StudyResults implements StudyResultsInterface {
	readonly #directory: string
	readonly #manifest: StudyManifest
	readonly #trials = new Map<string, StudyTrialCustody>()
	readonly #starting = new Set<string>()
	#phase: StudyCustodyPhase = 'new'
	#bytes = 0

	/**
	 * Owns a validated manifest snapshot without creating any files.
	 * @param options - The new result directory and execution declaration
	 * @throws StudyError - Thrown when the manifest is invalid
	 */
	constructor(options: StudyResultOptions) {
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
			if (files.length !== 1 + this.#manifest.schedule.length * 2)
				throw new StudyError('CUSTODY', 'Execution inventory is incomplete')
			for (const trial of this.#manifest.schedule) {
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
				version: 1,
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
