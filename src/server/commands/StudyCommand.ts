import type { JSONValue } from '@orkestrel/contract'
import type { StudyGrading, StudyManifest, StudyScenario } from '../../core/types.js'
import type { StudySealedResult } from '../stores/types.js'
import type {
	StudyCommandArtifact,
	StudyCommandOptions,
	StudyExecutionRequest,
	StudyGradeRequest,
	StudyGradingContext,
	StudyLabelRequest,
	StudyPreparation,
	StudyReportRequest,
} from './types.js'
import { arrayOf, isArray, isString, parseJSON } from '@orkestrel/contract'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { StudyError } from '../../core/errors.js'
import { buildStudySchedule, validateStudyInputs } from '../../core/helpers.js'
import {
	parseStudyDefinition,
	parseStudyGrading,
	parseStudyLabeling,
	parseStudyProfile,
	parseStudyRubric,
	parseStudyScenario,
} from '../../core/parsers.js'
import { StudySeries } from '../../core/engines/StudySeries.js'
import { StudyArtifactLoader } from '../processes/StudyArtifactLoader.js'
import { StudyProcessDriver } from '../processes/StudyProcessDriver.js'
import { computeStudyProfileDigest, valueToWire } from '../processes/helpers.js'
import { decodeStudyJSON, encodeStudyJSON, hashStudyBytes } from '../helpers.js'
import { STUDY_CUSTODY_BYTES, STUDY_PACKET_DISCLOSURE } from '../stores/constants.js'
import {
	buildStudyPacket,
	checkStudyDirectory,
	computeStudyPacketDigest,
	readStudyBytes,
	readStudyResult,
	translateStudyPacketLabeling,
} from '../stores/helpers.js'
import { StudyGradingStore } from '../stores/StudyGradingStore.js'
import { StudyResultStore } from '../stores/StudyResultStore.js'
import { StudyTask } from '../processes/StudyTask.js'
import { isStudyJudgment } from '../../core/validators.js'
import { STUDY_COMMAND_DURATION, STUDY_COMMAND_GRADER } from './constants.js'
import {
	collectStudyEvidence,
	computeStudyCommandFingerprint,
	computeStudyFixtureDigest,
	computeStudyReport,
	resolveStudyPath,
	resolveStudyProfile,
} from './helpers.js'
import { parseStudyArguments } from './parsers.js'

/** Executes validated study operations with execution and grading custody kept independent. */
export class StudyCommand {
	readonly #root: string
	readonly #entry: string

	/**
	 * Owns the trusted host entry and repository location without reading or writing files.
	 * @param options - The repository root and built trusted application entry
	 */
	constructor(options: StudyCommandOptions) {
		this.#root = resolve(options.root)
		this.#entry = resolve(this.#root, options.entry)
	}

	/**
	 * Parses command tokens once and executes their independent operation.
	 * @param arguments_ - The exact command tokens
	 * @param signal - The caller's execution cancellation
	 * @returns Truthful operation metadata or a verified whole-horizon report
	 * @throws StudyError - Thrown when arguments, declarations, identities, or custody fail
	 */
	async execute(arguments_: readonly string[], signal: AbortSignal): Promise<JSONValue> {
		const request = parseStudyArguments(arguments_)
		signal.throwIfAborted()
		if (request.command === 'check') return this.#check(await this.#prepare(request, signal))
		if (request.command === 'execute') return this.#execution(request, signal)
		if (request.command === 'grade') return this.#grade(request, signal)
		if (request.command === 'label') return this.#label(request, signal)
		if (request.command === 'report') return this.#report(request, signal)
		throw new StudyError('CONFIG', 'Unsupported study operation')
	}

	async #prepare(request: StudyExecutionRequest, signal: AbortSignal): Promise<StudyPreparation> {
		const directory = resolveStudyPath(join(this.#root, 'studies'), request.target)
		const definitionBytes = await readStudyBytes(
			resolveStudyPath(directory, 'study.json'),
			STUDY_CUSTODY_BYTES,
		)
		const definition = parseStudyDefinition(decodeStudyJSON(definitionBytes))
		if (definition.name !== request.target)
			throw new StudyError('CONFIG', 'Study name differs from its selected directory')
		const bundle = resolveStudyPath(join(this.#root, 'studies'), definition.driver)
		const steps: Array<{
			readonly scenario: StudyScenario
			readonly fixture: StudyCommandArtifact
		}> = []
		for (const id of definition.scenarios) {
			signal.throwIfAborted()
			const path = `scenarios/${id}.json`
			const bytes = await readStudyBytes(resolveStudyPath(bundle, path), STUDY_CUSTODY_BYTES)
			const scenario = parseStudyScenario(decodeStudyJSON(bytes))
			if (scenario.id !== id) throw new StudyError('CONFIG', 'Scenario identity is incompatible')
			steps.push({ scenario, fixture: { path, digest: hashStudyBytes(bytes) } })
		}
		const scenarios = steps.map((step) => step.scenario)
		const fixtures = steps.map((step) => step.fixture)
		const profileBytes = await readStudyBytes(
			resolveStudyPath(bundle, `profiles/${request.profile}.json`),
			STUDY_CUSTODY_BYTES,
		)
		const source = parseStudyProfile(decodeStudyJSON(profileBytes))
		if (source.name !== request.profile)
			throw new StudyError('CONFIG', 'Profile name differs from its selected file')
		if (source.bounds.series.duration > STUDY_COMMAND_DURATION)
			throw new StudyError('CONFIG', 'Series duration exceeds the 24-hour host ceiling')
		const profile = resolveStudyProfile(this.#root, source)
		const rubricBytes = await readStudyBytes(
			resolveStudyPath(directory, definition.rubric),
			STUDY_CUSTODY_BYTES,
		)
		const rubric = parseStudyRubric(decodeStudyJSON(rubricBytes))
		validateStudyInputs(definition, scenarios, rubric, profile)
		if (definition.purpose === 'quality' && profile.qualification === undefined)
			throw new StudyError('CONFIG', 'Quality studies require a capacity qualification')
		signal.throwIfAborted()
		const artifacts = new StudyArtifactLoader({
			root: this.#root,
			entry: this.#entry,
			profile,
			adapter: join(bundle, 'index.ts'),
		})
		const selected = await artifacts.inspect()
		const validation = await new StudyTask({
			root: this.#root,
			entry: this.#entry,
			adapter: join(bundle, 'index.ts'),
			roots: profile.roots,
		}).execute({ operation: 'validate', input: { definition, scenarios, rubric, profile } }, signal)
		if (validation.value !== true || validation.instrument !== selected.instrument)
			throw new StudyError('FAULT', 'Adapter validation identity differs')
		artifacts.verify()
		return {
			directory: bundle,
			definition,
			scenarios: Object.freeze(scenarios),
			rubric,
			profile,
			identity: {
				...selected,
				fixtures: computeStudyFixtureDigest(definition, fixtures),
				profile: computeStudyProfileDigest(profile),
			},
			artifacts,
			source: hashStudyBytes(profileBytes),
		}
	}

	#check(preparation: StudyPreparation): JSONValue {
		const fingerprint = computeStudyCommandFingerprint(
			preparation.identity,
			preparation.profile.bounds,
			preparation.definition,
		)
		return valueToWire({
			command: 'check',
			study: preparation.definition.name,
			purpose: preparation.definition.purpose,
			driver: preparation.definition.driver,
			profile: preparation.profile.name,
			bounds: preparation.profile.bounds,
			identity: preparation.identity,
			provenance: { profile: preparation.source },
			fingerprint,
			next: [
				'execute',
				preparation.definition.name,
				'--profile',
				preparation.profile.name,
				'--expected',
				fingerprint,
			],
			schedule: buildStudySchedule(preparation.definition, preparation.scenarios),
		})
	}

	async #execution(request: StudyExecutionRequest, signal: AbortSignal): Promise<JSONValue> {
		const preparation = await this.#prepare(request, signal)
		const fingerprint = computeStudyCommandFingerprint(
			preparation.identity,
			preparation.profile.bounds,
			preparation.definition,
		)
		if (request.expected !== undefined && request.expected !== fingerprint)
			throw new StudyError('CONFIG', 'Validated execution changed after the supervisor check')
		signal.throwIfAborted()
		const id = randomUUID()
		const qualification = await this.#qualification(preparation)
		signal.throwIfAborted()
		const parent = await this.#temporary()
		signal.throwIfAborted()
		const directory = request.out === undefined ? join(parent, id) : this.#file(request.out)
		const manifest: StudyManifest = {
			id,
			created: new Date().toISOString(),
			definition: preparation.definition,
			scenarios: preparation.scenarios,
			identity: preparation.identity,
			schedule: buildStudySchedule(preparation.definition, preparation.scenarios),
			bounds: preparation.profile.bounds,
			qualification,
			host: {
				node: process.version,
				platform: process.platform,
				architecture: process.arch,
				profile: preparation.source,
				roots: JSON.stringify(preparation.profile.roots),
			},
		}
		const store = new StudyResultStore({ directory, manifest })
		await store.create()
		const scratch = await mkdtemp(join(parent, 'scratch-'))
		try {
			const driver = new StudyProcessDriver({
				root: this.#root,
				entry: this.#entry,
				profile: preparation.profile,
				identity: preparation.identity,
				driver: preparation.definition.driver,
				adapter: join(preparation.directory, 'index.ts'),
				directory: scratch,
			})
			const attempts = await new StudySeries({ manifest, driver, store, signal }).execute()
			preparation.artifacts.verify()
			const seal = await store.seal()
			return valueToWire({
				command: 'execute',
				status: attempts.some((attempt) => attempt.failure !== undefined)
					? 'operational-failure'
					: 'completed',
				result: id,
				path: directory,
				seal: seal.id,
				fingerprint,
				next: [
					'grade',
					directory,
					'--rubric',
					resolveStudyPath(
						resolveStudyPath(join(this.#root, 'studies'), preparation.definition.name),
						preparation.definition.rubric,
					),
				],
			})
		} finally {
			await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
		}
	}

	async #grade(request: StudyGradeRequest, signal: AbortSignal): Promise<JSONValue> {
		const result = await this.#result(request.target)
		const bytes = await readStudyBytes(this.#file(request.rubric), STUDY_CUSTODY_BYTES)
		const rubric = parseStudyRubric(decodeStudyJSON(bytes))
		const evidence = await collectStudyEvidence(result)
		signal.throwIfAborted()
		const roots = parseJSON(result.manifest.host.roots ?? '')
		if (!arrayOf(isString)(roots))
			throw new StudyError('CONFIG', 'Execution does not retain adapter dependency roots')
		const evaluated = await new StudyTask({
			root: this.#root,
			entry: this.#entry,
			adapter: join(
				resolveStudyPath(join(this.#root, 'studies'), result.manifest.definition.driver),
				'index.ts',
			),
			roots,
		}).execute(
			{
				operation: 'grade',
				input: { manifest: result.manifest, rubric, attempts: result.attempts, evidence },
			},
			signal,
		)
		const judgments: unknown = evaluated.value
		if (!isArray(judgments) || !judgments.every(isStudyJudgment))
			throw new StudyError('FAULT', 'Grader returned invalid judgments')
		const digest = hashStudyBytes(bytes)
		const packet = buildStudyPacket(result, rubric, digest)
		const grading: StudyGrading = {
			result: result.seal.id,
			rubric: digest,
			grader: STUDY_COMMAND_GRADER,
			instrument: evaluated.instrument,
			attempts: result.manifest.schedule.map((trial) => trial.id),
			labels: undefined,
			judgments,
			...(packet === undefined ? {} : { packet: computeStudyPacketDigest(packet) }),
		}
		const store = new StudyGradingStore({
			result,
			rubric: bytes,
			...(packet === undefined ? {} : { packet }),
		})
		const id = await store.write(grading)
		return valueToWire({
			command: 'grade',
			result: result.manifest.id,
			grading: id,
			next: ['report', result.directory, '--grading', id],
			...(packet === undefined
				? {}
				: {
						packet: {
							id: hashStudyBytes(packet.content),
							path: join(result.directory, 'grades', id, `${grading.packet}.packet.json`),
							disclosure: STUDY_PACKET_DISCLOSURE,
						},
					}),
		})
	}

	async #label(request: StudyLabelRequest, signal: AbortSignal): Promise<JSONValue> {
		const result = await this.#result(request.target)
		const previous = await this.#grading(result, request.grading)
		if (previous.packet === undefined || previous.grading.packet === undefined)
			throw new StudyError('EVIDENCE', 'Selected grading has no semantic packet')
		const bytes = await readStudyBytes(this.#file(request.labels), STUDY_CUSTODY_BYTES)
		const labels = parseStudyLabeling(decodeStudyJSON(bytes))
		const translated = translateStudyPacketLabeling(
			result,
			previous.rubric,
			previous.grading.rubric,
			labels,
		)
		signal.throwIfAborted()
		const grading: StudyGrading = {
			...previous.grading,
			// Binds the preceding grader so equal labels over distinct gradings stay distinct.
			instrument: hashStudyBytes(
				JSON.stringify([previous.grading.instrument, await this.#instrument()]),
			),
			labels: hashStudyBytes(bytes),
			judgments: previous.grading.judgments.map((judgment) => {
				const imported = translated.find(
					(entry) => entry.trial === judgment.trial && entry.criterion === judgment.criterion,
				)
				if (imported !== undefined) return imported
				if (
					previous.rubric.criteria.find((criterion) => criterion.id === judgment.criterion)
						?.method !== 'semantic'
				)
					return judgment
				return {
					...judgment,
					verdict: 'unknown',
					method: 'human',
					reason: 'No label in the selected imported packet',
					references: [],
				}
			}),
		}
		const store = new StudyGradingStore({
			result,
			rubric: previous.bytes,
			labels: bytes,
			packet: previous.packet,
		})
		const id = await store.write(grading)
		return valueToWire({
			command: 'label',
			result: result.manifest.id,
			previous: request.grading,
			grading: id,
			packet: labels.packet,
			next: ['report', result.directory, '--grading', id],
		})
	}

	async #report(request: StudyReportRequest, signal: AbortSignal): Promise<JSONValue> {
		const result = await this.#result(request.target)
		const context = await this.#grading(result, request.grading)
		signal.throwIfAborted()
		const labels =
			context.labels === undefined ? undefined : parseStudyLabeling(decodeStudyJSON(context.labels))
		return valueToWire({
			command: 'report',
			grading: request.grading,
			report: computeStudyReport(result, context.rubric, context.grading),
			labeling:
				labels === undefined
					? { status: 'absent' }
					: { labeler: labels.labeler, version: labels.version, usage: labels.usage },
		})
	}

	async #result(target: string): Promise<StudySealedResult> {
		const path = isAbsolute(target)
			? resolve(target)
			: target.includes('/')
				? resolveStudyPath(this.#root, target)
				: resolveStudyPath(join(this.#root, 'tmp', 'studies'), target)
		const result = await readStudyResult(path)
		if (result.status !== 'sealed')
			throw new StudyError('CUSTODY', 'Interrupted execution cannot be graded or reported')
		return result
	}

	async #grading(result: StudySealedResult, id: string): Promise<StudyGradingContext> {
		const directory = join(result.directory, 'grades', id)
		const raw = await readStudyBytes(join(directory, 'grading.json'), STUDY_CUSTODY_BYTES).catch(
			(error: unknown) => {
				if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
					throw new StudyError(
						'CUSTODY',
						`Selected grading is missing: ${join(directory, 'grading.json')}`,
					)
				throw error
			},
		)
		if (hashStudyBytes(raw) !== id)
			throw new StudyError('CUSTODY', 'Selected grading differs from its byte identity')
		const declared = parseStudyGrading(decodeStudyJSON(raw))
		const bytes = await readStudyBytes(
			join(directory, `${declared.rubric}.rubric.json`),
			STUDY_CUSTODY_BYTES,
		)
		const rubric = parseStudyRubric(decodeStudyJSON(bytes))
		const grading = await new StudyGradingStore({ result, rubric: bytes }).read(id)
		if (grading === undefined)
			throw new StudyError('CUSTODY', `Selected grading is missing: ${directory}`)
		const packet =
			grading.packet === undefined
				? undefined
				: {
						content: await readStudyBytes(
							join(directory, `${grading.packet}.packet.json`),
							STUDY_CUSTODY_BYTES,
						),
						mapping: await readStudyBytes(
							join(directory, `${grading.packet}.mapping.json`),
							STUDY_CUSTODY_BYTES,
						),
					}
		const labels =
			grading.labels === undefined
				? undefined
				: await readStudyBytes(
						join(directory, `${grading.labels}.labels.json`),
						STUDY_CUSTODY_BYTES,
					)
		if (
			hashStudyBytes(bytes) !== grading.rubric ||
			(packet !== undefined && computeStudyPacketDigest(packet) !== grading.packet) ||
			(labels !== undefined && hashStudyBytes(labels) !== grading.labels)
		)
			throw new StudyError(
				'CUSTODY',
				'Grading artifacts changed while reading their verified context',
			)
		return { grading, rubric, bytes, packet, labels }
	}

	#file(path: string): string {
		return isAbsolute(path) ? resolve(path) : resolveStudyPath(this.#root, path)
	}

	#temporary(): Promise<string> {
		return ['tmp', 'studies'].reduce(async (previous, name) => {
			const directory = join(await previous, name)
			try {
				await mkdir(directory)
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
			}
			return checkStudyDirectory(directory)
		}, checkStudyDirectory(this.#root))
	}

	async #qualification(preparation: StudyPreparation): Promise<string | undefined> {
		if (
			preparation.profile.qualification === undefined ||
			preparation.definition.purpose === 'capacity'
		)
			return undefined
		const result = await this.#result(preparation.profile.qualification)
		if (
			result.manifest.definition.purpose !== 'capacity' ||
			hashStudyBytes(encodeStudyJSON(result.manifest.identity)) !==
				hashStudyBytes(encodeStudyJSON(preparation.identity)) ||
			hashStudyBytes(encodeStudyJSON(result.manifest.bounds)) !==
				hashStudyBytes(encodeStudyJSON(preparation.profile.bounds)) ||
			hashStudyBytes(encodeStudyJSON(result.manifest.schedule)) !==
				hashStudyBytes(
					encodeStudyJSON(buildStudySchedule(preparation.definition, preparation.scenarios)),
				) ||
			hashStudyBytes(encodeStudyJSON(result.manifest.scenarios)) !==
				hashStudyBytes(encodeStudyJSON(preparation.scenarios)) ||
			result.attempts.some(
				(attempt) =>
					attempt.failure !== undefined ||
					attempt.observations.some(
						(observation) => observation.failure !== undefined || observation.product === undefined,
					),
			)
		)
			throw new StudyError(
				'CONFIG',
				'Qualification requires a compatible complete capacity result with no operational failures',
			)
		return result.seal.id
	}

	async #instrument(): Promise<string> {
		return hashStudyBytes(await readStudyBytes(this.#entry, STUDY_CUSTODY_BYTES))
	}
}
