import type { StudyAssessment, StudyLabels, StudyRubric } from '@src/core'
import type { StudyAssessmentStoreOptions, StudyPacketBundle, StudySealedResult } from './types.js'
import {
	StudyError,
	computeStudyScores,
	parseStudyAssessment,
	parseStudyLabels,
	parseStudyRubric,
	isStudyDigest,
} from '@src/core'
import { canonicalStringify } from '@orkestrel/contract'
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeStudyJSON, encodeStudyJSON, hashStudyBytes, matchesSystemError } from '../helpers.js'
import { STUDY_CUSTODY_BYTES } from './constants.js'
import {
	checkStudyDirectory,
	buildStudyPacket,
	computeStudyPacketDigest,
	readStudyBytes,
	readStudyResult,
	translateStudyPacketLabels,
	writeStudyBytes,
} from './helpers.js'

/** Retains immutable deterministic grading versions independently of execution bytes. */
export class StudyAssessmentStore {
	readonly #directory: string
	readonly #seal: string
	readonly #rubric: StudyRubric
	readonly #rubricBytes: Uint8Array
	readonly #rubricDigest: string
	readonly #labels: StudyLabels | undefined
	readonly #labelsBytes: Uint8Array | undefined
	readonly #labelsDigest: string | undefined
	readonly #packet: StudyPacketBundle | undefined
	// The writes not yet settled; a write joins when called and leaves when it settles, and each waits for every earlier one.
	readonly #writes = new Set<Promise<string>>()

	/**
	 * Owns exact imported grading bytes without writing any custody files.
	 * @param options - The verified execution and exact rubric and optional labels bytes
	 * @throws StudyError - Thrown when imported bytes exceed bounds or fail validation
	 */
	constructor(options: StudyAssessmentStoreOptions) {
		if (options.result.status !== 'sealed')
			throw new StudyError('CUSTODY', 'Grading requires a sealed execution')
		if (
			options.rubric.byteLength > STUDY_CUSTODY_BYTES ||
			(options.labels !== undefined && options.labels.byteLength > STUDY_CUSTODY_BYTES)
		)
			throw new StudyError('CAPACITY', 'Imported grading bytes exceed the metadata allowance')
		this.#directory = options.result.directory
		this.#seal = options.result.seal.id
		this.#rubricBytes = new Uint8Array(options.rubric)
		this.#rubricDigest = hashStudyBytes(this.#rubricBytes)
		this.#rubric = parseStudyRubric(decodeStudyJSON(this.#rubricBytes))
		this.#labelsBytes = options.labels === undefined ? undefined : new Uint8Array(options.labels)
		this.#labelsDigest =
			this.#labelsBytes === undefined ? undefined : hashStudyBytes(this.#labelsBytes)
		this.#labels =
			this.#labelsBytes === undefined
				? undefined
				: parseStudyLabels(decodeStudyJSON(this.#labelsBytes))
		if (
			options.packet !== undefined &&
			(options.packet.content.byteLength > STUDY_CUSTODY_BYTES ||
				options.packet.mapping.byteLength > STUDY_CUSTODY_BYTES)
		)
			throw new StudyError('CAPACITY', 'Packet exceeds the grading metadata allowance')
		this.#packet =
			options.packet === undefined
				? undefined
				: {
						content: new Uint8Array(options.packet.content),
						mapping: new Uint8Array(options.packet.mapping),
					}
	}

	/**
	 * Retains a deterministic grading version or verifies identical existing bytes.
	 * @param assessment - The complete evidence-backed judgments and artifact bindings
	 * @returns The exact grading-byte SHA-256 identity
	 * @throws StudyError - Thrown when coverage, bindings, or existing bytes are invalid
	 */
	write(assessment: StudyAssessment): Promise<string> {
		try {
			const snapshot = parseStudyAssessment(assessment)
			const bytes = encodeStudyJSON(snapshot)
			if (bytes.byteLength > STUDY_CUSTODY_BYTES)
				throw new StudyError('CAPACITY', 'Grading exceeds the metadata allowance')
			const previous = Promise.allSettled([...this.#writes])
			const operation = previous.then(() => this.#write(snapshot, bytes))
			this.#writes.add(operation)
			void operation.then(
				() => this.#writes.delete(operation),
				() => this.#writes.delete(operation),
			)
			return operation
		} catch (error) {
			return Promise.reject(error)
		}
	}

	/**
	 * Reads an immutable grading version and verifies every bound artifact byte.
	 * @param id - The grading-byte SHA-256 identity
	 * @returns The verified assessment, or undefined when the version does not exist
	 * @throws StudyError - Thrown when an existing version is partial or tampered
	 */
	async read(id: string): Promise<StudyAssessment | undefined> {
		if (!isStudyDigest(id)) throw new StudyError('EVIDENCE', 'Invalid grading identity')
		const result = await this.#verifyResult()
		const directory = join(result.directory, 'grades', id)
		try {
			await lstat(directory)
		} catch (error) {
			if (matchesSystemError(error, 'ENOENT')) return undefined
			throw error
		}
		await checkStudyDirectory(directory)
		const bytes = await readStudyBytes(join(directory, 'grading.json'), STUDY_CUSTODY_BYTES)
		if (hashStudyBytes(bytes) !== id)
			throw new StudyError('CUSTODY', 'Grading identity differs from its exact bytes')
		const assessment = parseStudyAssessment(decodeStudyJSON(bytes))
		const expected = [
			'grading.json',
			`${assessment.rubric}.rubric.json`,
			...(assessment.labels === undefined ? [] : [`${assessment.labels}.labels.json`]),
			...(assessment.packet === undefined
				? []
				: [`${assessment.packet}.packet.json`, `${assessment.packet}.mapping.json`]),
		]
		const entries = await readdir(directory, { withFileTypes: true })
		if (
			entries.length !== expected.length ||
			entries.some(
				(entry) => !entry.isFile() || entry.isSymbolicLink() || !expected.includes(entry.name),
			)
		)
			throw new StudyError('CUSTODY', 'Grading inventory differs from its bound artifacts')
		const rubricBytes = await readStudyBytes(
			join(directory, `${assessment.rubric}.rubric.json`),
			STUDY_CUSTODY_BYTES,
		)
		if (hashStudyBytes(rubricBytes) !== assessment.rubric)
			throw new StudyError('CUSTODY', 'Rubric bytes differ from the grading identity')
		const rubric = parseStudyRubric(decodeStudyJSON(rubricBytes))
		const labels =
			assessment.labels === undefined
				? undefined
				: await this.#retrieve(directory, assessment.labels)
		const packet: StudyPacketBundle | undefined =
			assessment.packet === undefined
				? undefined
				: {
						content: await readStudyBytes(
							join(directory, `${assessment.packet}.packet.json`),
							STUDY_CUSTODY_BYTES,
						),
						mapping: await readStudyBytes(
							join(directory, `${assessment.packet}.mapping.json`),
							STUDY_CUSTODY_BYTES,
						),
					}
		this.#validate(assessment, result, rubric, labels, packet)
		await this.#verifyResult()
		return assessment
	}

	async #retrieve(directory: string, digest: string): Promise<StudyLabels> {
		const bytes = await readStudyBytes(
			join(directory, `${digest}.labels.json`),
			STUDY_CUSTODY_BYTES,
		)
		if (hashStudyBytes(bytes) !== digest)
			throw new StudyError('CUSTODY', 'Labels bytes differ from the grading identity')
		return parseStudyLabels(decodeStudyJSON(bytes))
	}

	async #write(assessment: StudyAssessment, bytes: Uint8Array): Promise<string> {
		const result = await this.#verifyResult()
		if (assessment.rubric !== this.#rubricDigest || assessment.labels !== this.#labelsDigest)
			throw new StudyError('EVIDENCE', 'Grading does not bind the imported artifact bytes')
		this.#validate(assessment, result, this.#rubric, this.#labels, this.#packet)
		const id = hashStudyBytes(bytes)
		const root = join(result.directory, 'grades')
		try {
			await mkdir(root)
		} catch (error) {
			if (!matchesSystemError(error, 'EEXIST')) throw error
		}
		await checkStudyDirectory(root)
		const directory = join(root, id)
		try {
			await mkdir(directory)
		} catch (error) {
			if (!matchesSystemError(error, 'EEXIST')) throw error
			const existing = await this.read(id)
			if (
				existing === undefined ||
				canonicalStringify(existing) !== canonicalStringify(assessment) ||
				hashStudyBytes(
					await readStudyBytes(join(directory, 'grading.json'), STUDY_CUSTODY_BYTES),
				) !== id
			)
				throw new StudyError('CUSTODY', 'Existing grading version is incompatible')
			return id
		}
		await writeStudyBytes(join(directory, `${this.#rubricDigest}.rubric.json`), this.#rubricBytes)
		if (this.#packet !== undefined && assessment.packet !== undefined) {
			await writeStudyBytes(
				join(directory, `${assessment.packet}.packet.json`),
				this.#packet.content,
			)
			await writeStudyBytes(
				join(directory, `${assessment.packet}.mapping.json`),
				this.#packet.mapping,
			)
		}
		if (this.#labelsBytes !== undefined && this.#labelsDigest !== undefined)
			await writeStudyBytes(join(directory, `${this.#labelsDigest}.labels.json`), this.#labelsBytes)
		await writeStudyBytes(join(directory, 'grading.json'), bytes)
		await this.read(id)
		return id
	}

	async #verifyResult(): Promise<StudySealedResult> {
		const result = await readStudyResult(this.#directory)
		if (result.status !== 'sealed' || result.seal.id !== this.#seal)
			throw new StudyError('CUSTODY', 'Execution no longer matches the verified seal')
		return result
	}

	#validate(
		assessment: StudyAssessment,
		result: StudySealedResult,
		rubric: StudyRubric,
		labels: StudyLabels | undefined,
		packet: StudyPacketBundle | undefined,
	): void {
		if (assessment.result !== result.seal.id)
			throw new StudyError('EVIDENCE', 'Grading binds a different execution seal')
		computeStudyScores(result.manifest, rubric, assessment)
		if (assessment.packet !== (packet === undefined ? undefined : computeStudyPacketDigest(packet)))
			throw new StudyError('CUSTODY', 'Grading packet bytes do not match their bundle identity')
		if (packet !== undefined) {
			const expected = buildStudyPacket(result, rubric, assessment.rubric)
			if (
				expected === undefined ||
				hashStudyBytes(expected.content) !== hashStudyBytes(packet.content) ||
				hashStudyBytes(expected.mapping) !== hashStudyBytes(packet.mapping)
			)
				throw new StudyError('CUSTODY', 'Grading packet differs from the sealed semantic horizon')
		}
		if (labels !== undefined && packet === undefined)
			throw new StudyError('EVIDENCE', 'Imported labels require a retained semantic packet')
		const translated =
			labels === undefined
				? []
				: translateStudyPacketLabels(result, rubric, assessment.rubric, labels)
		for (const trial of result.manifest.schedule) {
			for (const criterion of rubric.criteria) {
				if (criterion.scenario !== trial.scenario) continue
				const judgment = assessment.judgments.find(
					(entry) => entry.trial === trial.id && entry.criterion === criterion.id,
				)
				if (judgment === undefined)
					throw new StudyError('EVIDENCE', 'Grading must record every scheduled criterion judgment')
				if (
					criterion.method === 'semantic' &&
					judgment.verdict !== 'unknown' &&
					!translated.some((entry) => canonicalStringify(entry) === canonicalStringify(judgment))
				)
					throw new StudyError('EVIDENCE', 'Semantic verdict has no bound imported label')
			}
		}
		for (const judgment of translated) {
			if (
				!assessment.judgments.some(
					(entry) => canonicalStringify(entry) === canonicalStringify(judgment),
				)
			)
				throw new StudyError(
					'EVIDENCE',
					'Imported label is absent or differs from its recorded judgment',
				)
		}
	}
}
