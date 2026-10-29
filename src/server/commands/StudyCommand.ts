import type { StudyAssessment, StudyManifest } from '@src/core'
import type { JSONValue } from '@orkestrel/contract'
import type { StudySealedResult } from '../stores/types.js'
import type { StudyOllamaReplaySelection } from '../ollama/types.js'
import type {
	StudyCommandOptions,
	StudyExecutionRequest,
	StudyGradeRequest,
	StudyAssessmentContext,
	StudyLabelRequest,
	StudyPreparation,
	StudyReportRequest,
	StudyFreezeRequest,
	StudyClosure,
	StudyContinuation,
} from './types.js'
import {
	StudyError,
	buildStudySchedule,
	validateStudyInputs,
	parseStudyAssessment,
	parseStudyLabels,
	parseStudyProfile,
	parseStudyRubric,
	StudySeries,
	isStudyJudgment,
} from '@src/core'
import { arrayOf, canonicalStringify, isArray, isString, parseJSON } from '@orkestrel/contract'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { StudyArtifactLoader } from '../processes/StudyArtifactLoader.js'
import { StudyProcessDriver } from '../processes/StudyProcessDriver.js'
import { StudyDaemonSession } from './StudyDaemonSession.js'
import {
	buildStudyExchangeDeclaration,
	computeStudyInstrumentDigest,
	computeStudyProfileDigest,
	resolveStudyInstrument,
	readStudyReplayHistory,
	valueToWire,
} from '../processes/helpers.js'
import { ArtifactLoader } from '../artifacts/ArtifactLoader.js'
import { relocateArtifactPath, verifyArtifactClosure } from '../artifacts/helpers.js'
import { decodeStudyJSON, encodeStudyJSON, hashStudyBytes, matchesSystemError } from '../helpers.js'
import { STUDY_CUSTODY_BYTES, STUDY_PACKET_DISCLOSURE } from '../stores/constants.js'
import {
	buildStudyPacket,
	checkStudyDirectory,
	computeStudyPacketDigest,
	readStudyBytes,
	readStudyResult,
	readStudyExchanges,
	translateStudyPacketLabels,
} from '../stores/helpers.js'
import { StudyAssessmentStore } from '../stores/StudyAssessmentStore.js'
import { StudyResultStore } from '../stores/StudyResultStore.js'
import { StudyTask } from '../processes/StudyTask.js'
import { STUDY_COMMAND_DURATION, STUDY_COMMAND_GRADER } from './constants.js'
import {
	collectStudyEvidence,
	computeStudyCommandFingerprint,
	computeStudyFixtureDigest,
	computeStudyReport,
	resolveStudyPath,
	resolveStudyProfile,
	readStudyDeclaration,
	readStudyDeclarationBytes,
	readStudyClosure,
} from './helpers.js'
import { parseStudyArguments } from './parsers.js'
import { isStudyReplaySelection } from '../processes/validators.js'

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
		if (request.command === 'check') {
			const continuation =
				request.extend === undefined ? undefined : await this.#extend(request, signal)
			const preparation = await this.#prepare(request, signal)
			if (continuation !== undefined) await this.#extend(request, signal, preparation)
			return this.#check(preparation, continuation)
		}
		if (request.command === 'execute') return this.#execution(request, signal)
		if (request.command === 'freeze') return this.#freeze(request, signal)
		if (request.command === 'grade') return this.#grade(request, signal)
		if (request.command === 'label') return this.#label(request, signal)
		if (request.command === 'report') return this.#report(request, signal)
		throw new StudyError('CONFIG', 'Unsupported study operation')
	}

	async #freeze(request: StudyFreezeRequest, signal: AbortSignal): Promise<JSONValue> {
		const selection: StudyExecutionRequest = {
			command: 'check',
			target: request.target,
			profile: request.profile,
			out: undefined,
			expected: undefined,
		}
		const original = await this.#prepare(selection, signal)
		const instrument = resolveStudyInstrument(this.#entry)
		const directory = resolveStudyPath(join(this.#root, 'studies'), request.target)
		const assets = [
			...new Set([
				this.#entry,
				join(directory, 'study.json'),
				resolveStudyPath(directory, original.definition.rubric),
				resolveStudyPath(original.bundle, `profiles/${request.profile}.json`),
				...original.definition.scenarios.map((id) =>
					resolveStudyPath(original.bundle, `scenarios/${id}.json`),
				),
			]),
		]
		const loader = new ArtifactLoader({
			entries: [
				...new Set([
					original.profile.agent,
					original.profile.subject,
					...(original.profile.provider === undefined ? [] : [original.profile.provider.entry]),
				]),
			],
			roots: [...new Set([...original.profile.roots, instrument])],
			source: { root: original.bundle, entry: join(original.bundle, 'index.ts') },
			instrument,
			assets,
		})
		loader.inspect()
		signal.throwIfAborted()
		const closure = await loader.materialize(request.destination)
		const candidate: StudyClosure = {
			closure,
			root: relocateArtifactPath(closure, this.#root),
			entry: relocateArtifactPath(closure, this.#entry),
			target: request.target,
			profile: request.profile,
			source: original.identity,
			identity: original.identity,
			fingerprint: computeStudyCommandFingerprint(
				original.identity,
				original.profile.bounds,
				original.definition,
			),
		}
		const checked = await this.#prepare(selection, signal, candidate)
		if (
			checked.source !== original.source ||
			checked.identity.fixtures !== original.identity.fixtures ||
			hashStudyBytes(encodeStudyJSON(checked.definition)) !==
				hashStudyBytes(encodeStudyJSON(original.definition)) ||
			hashStudyBytes(encodeStudyJSON(checked.rubric)) !==
				hashStudyBytes(encodeStudyJSON(original.rubric))
		)
			throw new StudyError('FAULT', 'Study declarations changed during freezing')
		const publication: StudyClosure = {
			...candidate,
			identity: checked.identity,
			fingerprint: computeStudyCommandFingerprint(
				checked.identity,
				checked.profile.bounds,
				checked.definition,
			),
		}
		original.artifacts.verify()
		loader.verify()
		checked.artifacts.verify()
		verifyArtifactClosure(closure)
		signal.throwIfAborted()
		await writeFile(join(closure.destination, 'closure.json'), encodeStudyJSON(publication), {
			flag: 'wx',
		})
		return valueToWire({
			command: 'freeze',
			path: closure.destination,
			digest: closure.digest,
			fingerprint: publication.fingerprint,
		})
	}

	#closure(request: StudyExecutionRequest): StudyClosure {
		if (request.closure === undefined)
			throw new StudyError('CONFIG', 'Study closure selection is absent')
		const closure = readStudyClosure(resolve(this.#root, request.closure))
		if (closure.target !== request.target || closure.profile !== request.profile)
			throw new StudyError('CONFIG', 'Study closure selectors differ from the checked selection')
		return closure
	}

	async #prepare(
		request: StudyExecutionRequest,
		signal: AbortSignal,
		retained?: StudyClosure,
	): Promise<StudyPreparation> {
		const closure = retained ?? (request.closure === undefined ? undefined : this.#closure(request))
		const root = closure?.root ?? this.#root
		const entry = closure?.entry ?? this.#entry
		const { bundle, definition, scenarios, fixtures, rubric } = await readStudyDeclaration(
			root,
			request.target,
			signal,
		)
		const profileBytes = await readStudyDeclarationBytes(
			root,
			resolveStudyPath(bundle, `profiles/${request.profile}.json`),
		)
		const source = parseStudyProfile(decodeStudyJSON(profileBytes))
		if (source.name !== request.profile)
			throw new StudyError('CONFIG', 'Profile name differs from its selected file')
		if (source.bounds.series.duration > STUDY_COMMAND_DURATION)
			throw new StudyError('CONFIG', 'Series duration exceeds the 24-hour host ceiling')
		const profile = resolveStudyProfile(root, source, closure?.closure)
		validateStudyInputs(definition, scenarios, rubric, profile)
		signal.throwIfAborted()
		const artifacts = new StudyArtifactLoader({
			root,
			entry,
			profile,
			adapter: join(bundle, 'index.ts'),
			...(closure === undefined ? {} : { closure }),
		})
		const selected = await artifacts.inspect()
		const validation = await new StudyTask({
			root,
			entry,
			adapter: join(bundle, 'index.ts'),
			roots: profile.roots,
			...(closure === undefined ? {} : { closure }),
		}).execute({ operation: 'validate', input: { definition, scenarios, rubric, profile } }, signal)
		if (validation.value !== true || validation.instrument !== selected.instrument)
			throw new StudyError('FAULT', 'Adapter validation identity differs')
		artifacts.verify()
		const preparation: StudyPreparation = {
			bundle,
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
			...(closure === undefined ? {} : { closure }),
		}
		if (
			request.closure !== undefined &&
			closure !== undefined &&
			(computeStudyCommandFingerprint(preparation.identity, profile.bounds, definition) !==
				closure.fingerprint ||
				hashStudyBytes(encodeStudyJSON(preparation.identity)) !==
					hashStudyBytes(encodeStudyJSON(closure.identity)))
		)
			throw new StudyError(
				'FAULT',
				`Study closure checked identity differs: ${Object.entries(preparation.identity)
					.filter(([name, digest]) =>
						Object.entries(closure.identity).some(
							([key, expected]) => key === name && digest !== expected,
						),
					)
					.map(([name]) => name)
					.join(', ')}`,
			)
		return preparation
	}

	#check(preparation: StudyPreparation, continuation?: StudyContinuation): JSONValue {
		const fingerprint = computeStudyCommandFingerprint(
			preparation.identity,
			preparation.profile.bounds,
			preparation.definition,
			continuation?.ancestor.seal,
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
			...(preparation.closure === undefined
				? {}
				: {
						closure: {
							digest: preparation.closure.closure.digest,
							source: preparation.closure.source,
						},
					}),
			fingerprint,
			next: [
				'execute',
				preparation.definition.name,
				'--profile',
				preparation.profile.name,
				'--expected',
				fingerprint,
				...(preparation.closure === undefined
					? []
					: ['--closure', preparation.closure.closure.destination]),
				...(continuation === undefined ? [] : ['--extend', continuation.replay.result]),
			],
			schedule: buildStudySchedule(preparation.definition, preparation.scenarios),
		})
	}

	async #execution(request: StudyExecutionRequest, signal: AbortSignal): Promise<JSONValue> {
		const continuation =
			request.extend === undefined ? undefined : await this.#extend(request, signal)
		const replay =
			continuation?.replay ??
			(request.replay === undefined ? undefined : await this.#replay(request, signal))
		const source = replay === undefined ? undefined : await readStudyResult(replay.result)
		if (source !== undefined && source.status !== 'sealed')
			throw new StudyError('CUSTODY', 'Replay source is not sealed')
		const ancestor =
			continuation?.ancestor ??
			(source === undefined
				? undefined
				: { result: source.manifest.id, seal: source.seal.id, identity: source.manifest.identity })
		const preparation = await this.#prepare(request, signal)
		if (continuation !== undefined) await this.#extend(request, signal, preparation)
		const fingerprint = computeStudyCommandFingerprint(
			preparation.identity,
			preparation.profile.bounds,
			preparation.definition,
			continuation?.ancestor.seal,
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
		const scratch = await mkdtemp(join(parent, 'scratch-'))
		try {
			const daemon =
				preparation.profile.provider?.daemon === undefined || replay?.offline === true
					? undefined
					: new StudyDaemonSession({
							profile: preparation.profile,
							scenarios: preparation.scenarios,
							workspace: scratch,
							signal,
						})
			try {
				const startup = await daemon?.start()
				const manifest: StudyManifest = {
					id,
					created: new Date().toISOString(),
					definition: preparation.definition,
					scenarios: preparation.scenarios,
					identity: preparation.identity,
					...(ancestor === undefined ? {} : { ancestor }),
					schedule: buildStudySchedule(preparation.definition, preparation.scenarios),
					bounds: preparation.profile.bounds,
					...(preparation.profile.record === undefined
						? {}
						: { record: preparation.profile.record }),
					qualification,
					host: {
						node: process.version,
						platform: process.platform,
						architecture: process.arch,
						profile: preparation.source,
						roots: JSON.stringify(preparation.profile.roots),
						...(startup === undefined ? {} : { daemon: JSON.stringify(startup) }),
					},
				}
				const store = new StudyResultStore({ directory, manifest })
				await store.create()
				const destinations =
					preparation.profile.record === undefined
						? undefined
						: Object.fromEntries(
								await Promise.all(
									manifest.schedule.map(async (trial) => {
										const scenario = preparation.scenarios.find(
											(entry) => entry.id === trial.scenario,
										)
										if (scenario === undefined)
											throw new StudyError('CONFIG', 'Recording scenario is absent')
										const prefix = replay?.prefix[trial.id]
										if (replay !== undefined && prefix === undefined)
											throw new StudyError('CONFIG', 'Replay prefix is absent')
										const declaration = buildStudyExchangeDeclaration(
											preparation.profile,
											trial,
											scenario,
											daemon !== undefined,
											ancestor === undefined || replay === undefined || prefix === undefined
												? undefined
												: {
														...ancestor,
														file: (await readStudyReplayHistory(replay, preparation.profile, trial))
															.file,
														prefix,
													},
										)
										return [trial.id, await store.exchanges(trial, declaration)] as const
									}),
								),
							)
				const driver = new StudyProcessDriver({
					root: preparation.closure?.root ?? this.#root,
					entry: preparation.closure?.entry ?? this.#entry,
					profile: preparation.profile,
					identity: preparation.identity,
					driver: preparation.definition.driver,
					adapter: join(preparation.bundle, 'index.ts'),
					directory: scratch,
					...(preparation.closure === undefined ? {} : { closure: preparation.closure }),
					...(destinations === undefined ? {} : { exchanges: destinations }),
					...(replay === undefined ? {} : { replay }),
					...(daemon === undefined ? {} : { prepare: daemon.prepare.bind(daemon) }),
				})
				const attempts = await new StudySeries({ manifest, driver, store, signal }).execute()
				await daemon?.stop()
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
				await daemon?.stop()
			}
		} finally {
			await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
		}
	}

	async #extend(
		request: StudyExecutionRequest,
		signal: AbortSignal,
		preparation?: StudyPreparation,
	): Promise<StudyContinuation> {
		if (request.extend === undefined || request.replay !== undefined)
			throw new StudyError('CONFIG', 'Continuation requires an exclusive ancestor selection')
		const source = await this.#result(request.extend)
		if (
			source.manifest.record === undefined ||
			source.attempts.some(
				(attempt) =>
					attempt.failure !== undefined ||
					attempt.observations.some(
						(observation) =>
							observation.failure !== undefined ||
							observation.product === undefined ||
							observation.product.partial,
					),
			)
		)
			throw new StudyError('CONFIG', 'Continuation requires a complete recorded ancestor')
		const closure = request.closure === undefined ? undefined : this.#closure(request)
		const root = closure?.root ?? this.#root
		const entry = closure?.entry ?? this.#entry
		const { bundle, definition, scenarios } =
			preparation ?? (await readStudyDeclaration(root, request.target, signal))
		const profile =
			preparation?.profile ??
			resolveStudyProfile(
				root,
				parseStudyProfile(
					decodeStudyJSON(
						await readStudyDeclarationBytes(
							root,
							resolveStudyPath(bundle, `profiles/${request.profile}.json`),
						),
					),
				),
				closure?.closure,
			)
		if (
			profile.provider?.daemon === undefined ||
			profile.record === undefined ||
			profile.settings?.procedure !== undefined
		)
			throw new StudyError('CONFIG', 'Continuation requires open recording and provider.daemon')
		const schedule = buildStudySchedule(definition, scenarios)
		if (
			canonicalStringify(definition) !== canonicalStringify(source.manifest.definition) ||
			canonicalStringify(schedule) !== canonicalStringify(source.manifest.schedule) ||
			scenarios.length !== source.manifest.scenarios.length ||
			!scenarios.every((scenario, index) => {
				const ancestor = source.manifest.scenarios[index]
				return (
					ancestor !== undefined &&
					scenario.id === ancestor.id &&
					scenario.goals.length > ancestor.goals.length &&
					canonicalStringify(scenario.goals.slice(0, ancestor.goals.length)) ===
						canonicalStringify(ancestor.goals)
				)
			})
		)
			throw new StudyError(
				'CONFIG',
				'Continuation definition, schedule or strict goal prefix changed',
			)
		const prefixes: ReadonlyArray<readonly [string, number]> = await Promise.all(
			schedule.map(async (trial) => {
				signal.throwIfAborted()
				const history = await readStudyExchanges(source, trial.id)
				const scenario = scenarios.find((candidate) => candidate.id === trial.scenario)
				if (scenario === undefined)
					throw new StudyError('CONFIG', 'Continuation scenario is absent')
				const declaration = buildStudyExchangeDeclaration(profile, trial, scenario, true)
				if (
					history.declaration.procedure !== undefined ||
					history.declaration.version !== declaration.version ||
					canonicalStringify(history.declaration.models) !==
						canonicalStringify(declaration.models) ||
					history.declaration.configuration !== declaration.configuration ||
					canonicalStringify(history.declaration.maintenance) !==
						canonicalStringify(declaration.maintenance)
				)
					throw new StudyError('CONFIG', 'Continuation recording configuration changed')
				const prefix = history.exchanges.findIndex(({ attempt }) => attempt.stage === 'postflight')
				if (prefix < 0)
					throw new StudyError('CONFIG', 'Continuation ancestor has no complete postflight')
				return [trial.id, prefix] as const
			}),
		)
		const artifacts =
			preparation?.artifacts ??
			new StudyArtifactLoader({
				root,
				entry,
				profile,
				adapter: join(bundle, 'index.ts'),
				...(closure === undefined ? {} : { closure }),
			})
		const identity = await artifacts.inspect()
		if (
			identity.runtime !== source.manifest.identity.runtime ||
			identity.content !== source.manifest.identity.content
		)
			throw new StudyError('CONFIG', 'Continuation runtime or content changed')
		artifacts.verify()
		return {
			replay: { result: source.directory, prefix: Object.fromEntries(prefixes), offline: false },
			ancestor: {
				result: source.manifest.id,
				seal: source.seal.id,
				identity: source.manifest.identity,
			},
		}
	}

	async #replay(
		request: StudyExecutionRequest,
		signal: AbortSignal,
	): Promise<StudyOllamaReplaySelection> {
		if (!isStudyReplaySelection(request.replay))
			throw new StudyError(
				'CONFIG',
				'Replay requires an explicit sealed source, prefixes and offline behavior',
			)
		const selection = {
			...structuredClone(request.replay),
			result: this.#file(request.replay.result),
		}
		const source = await readStudyResult(selection.result)
		if (source.status !== 'sealed') throw new StudyError('CUSTODY', 'Replay source is not sealed')
		const closure = request.closure === undefined ? undefined : this.#closure(request)
		const root = closure?.root ?? this.#root
		const entry = closure?.entry ?? this.#entry
		const { bundle, definition, scenarios, fixtures } = await readStudyDeclaration(
			root,
			request.target,
			signal,
		)
		const bytes = await readStudyDeclarationBytes(
			root,
			resolveStudyPath(bundle, `profiles/${request.profile}.json`),
		)
		const profile = resolveStudyProfile(
			root,
			parseStudyProfile(decodeStudyJSON(bytes)),
			closure?.closure,
		)
		const schedule = buildStudySchedule(definition, scenarios)
		if (
			canonicalStringify(definition) !== canonicalStringify(source.manifest.definition) ||
			canonicalStringify(scenarios) !== canonicalStringify(source.manifest.scenarios) ||
			canonicalStringify(schedule) !== canonicalStringify(source.manifest.schedule) ||
			computeStudyFixtureDigest(definition, fixtures) !== source.manifest.identity.fixtures ||
			Object.keys(selection.prefix).length !== schedule.length ||
			!schedule.every((trial) => Object.hasOwn(selection.prefix, trial.id))
		)
			throw new StudyError('CONFIG', 'Replay declaration or scheduled membership changed')
		for (const trial of schedule) {
			signal.throwIfAborted()
			await readStudyReplayHistory(selection, profile, trial)
		}
		const artifacts = new StudyArtifactLoader({
			root,
			entry,
			profile,
			adapter: join(bundle, 'index.ts'),
			...(closure === undefined ? {} : { closure }),
		})
		const selected = await artifacts.inspect()
		const identity = {
			...selected,
			fixtures: computeStudyFixtureDigest(definition, fixtures),
			profile: computeStudyProfileDigest(profile),
		}
		if (selected.runtime !== source.manifest.identity.runtime)
			throw new StudyError('CONFIG', 'Replay runtime declaration changed')
		if (
			request.expected !== undefined &&
			request.expected !== computeStudyCommandFingerprint(identity, profile.bounds, definition)
		)
			throw new StudyError('CONFIG', 'Replay execution bounds or declaration changed after check')
		artifacts.verify()
		return selection
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
		const assessment: StudyAssessment = {
			result: result.seal.id,
			rubric: digest,
			grader: STUDY_COMMAND_GRADER,
			instrument: evaluated.instrument,
			attempts: result.manifest.schedule.map((trial) => trial.id),
			labels: undefined,
			judgments,
			...(packet === undefined ? {} : { packet: computeStudyPacketDigest(packet) }),
		}
		const store = new StudyAssessmentStore({
			result,
			rubric: bytes,
			...(packet === undefined ? {} : { packet }),
		})
		const id = await store.write(assessment)
		return valueToWire({
			command: 'grade',
			result: result.manifest.id,
			assessment: id,
			next: ['report', result.directory, '--assessment', id],
			...(packet === undefined
				? {}
				: {
						packet: {
							id: hashStudyBytes(packet.content),
							path: join(result.directory, 'grades', id, `${assessment.packet}.packet.json`),
							disclosure: STUDY_PACKET_DISCLOSURE,
						},
					}),
		})
	}

	async #label(request: StudyLabelRequest, signal: AbortSignal): Promise<JSONValue> {
		const result = await this.#result(request.target)
		const previous = await this.#assessment(result, request.assessment)
		if (previous.packet === undefined || previous.assessment.packet === undefined)
			throw new StudyError('EVIDENCE', 'Selected grading has no semantic packet')
		const bytes = await readStudyBytes(this.#file(request.labels), STUDY_CUSTODY_BYTES)
		const labels = parseStudyLabels(decodeStudyJSON(bytes))
		const translated = translateStudyPacketLabels(
			result,
			previous.rubric,
			previous.assessment.rubric,
			labels,
		)
		signal.throwIfAborted()
		const assessment: StudyAssessment = {
			...previous.assessment,
			// Binds the preceding grader so equal labels over distinct gradings stay distinct.
			instrument: hashStudyBytes(
				JSON.stringify([previous.assessment.instrument, await this.#instrument()]),
			),
			labels: hashStudyBytes(bytes),
			judgments: previous.assessment.judgments.map((judgment) => {
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
		const store = new StudyAssessmentStore({
			result,
			rubric: previous.bytes,
			labels: bytes,
			packet: previous.packet,
		})
		const id = await store.write(assessment)
		return valueToWire({
			command: 'label',
			result: result.manifest.id,
			previous: request.assessment,
			assessment: id,
			packet: labels.packet,
			next: ['report', result.directory, '--assessment', id],
		})
	}

	async #report(request: StudyReportRequest, signal: AbortSignal): Promise<JSONValue> {
		const result = await this.#result(request.target)
		const context = await this.#assessment(result, request.assessment)
		signal.throwIfAborted()
		const labels =
			context.labels === undefined ? undefined : parseStudyLabels(decodeStudyJSON(context.labels))
		return valueToWire({
			command: 'report',
			assessment: request.assessment,
			report: computeStudyReport(result, context.rubric, context.assessment),
			labels:
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
		const result = await readStudyResult(path).catch((error: unknown) => {
			if (matchesSystemError(error, 'ENOENT'))
				throw new StudyError('CUSTODY', `Selected result is missing: ${target}`)
			throw error
		})
		if (result.status !== 'sealed')
			throw new StudyError('CUSTODY', 'Interrupted execution cannot be graded or reported')
		return result
	}

	async #assessment(result: StudySealedResult, id: string): Promise<StudyAssessmentContext> {
		const directory = join(result.directory, 'grades', id)
		const raw = await readStudyBytes(join(directory, 'grading.json'), STUDY_CUSTODY_BYTES).catch(
			(error: unknown) => {
				if (matchesSystemError(error, 'ENOENT'))
					throw new StudyError(
						'CUSTODY',
						`Selected grading is missing: ${join(directory, 'grading.json')}`,
					)
				throw error
			},
		)
		if (hashStudyBytes(raw) !== id)
			throw new StudyError('CUSTODY', 'Selected grading differs from its byte identity')
		const declared = parseStudyAssessment(decodeStudyJSON(raw))
		const bytes = await readStudyBytes(
			join(directory, `${declared.rubric}.rubric.json`),
			STUDY_CUSTODY_BYTES,
		)
		const rubric = parseStudyRubric(decodeStudyJSON(bytes))
		const assessment = await new StudyAssessmentStore({ result, rubric: bytes }).read(id)
		if (assessment === undefined)
			throw new StudyError('CUSTODY', `Selected grading is missing: ${directory}`)
		const packet =
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
		const labels =
			assessment.labels === undefined
				? undefined
				: await readStudyBytes(
						join(directory, `${assessment.labels}.labels.json`),
						STUDY_CUSTODY_BYTES,
					)
		if (
			hashStudyBytes(bytes) !== assessment.rubric ||
			(packet !== undefined && computeStudyPacketDigest(packet) !== assessment.packet) ||
			(labels !== undefined && hashStudyBytes(labels) !== assessment.labels)
		)
			throw new StudyError(
				'CUSTODY',
				'Grading artifacts changed while reading their verified context',
			)
		return { assessment, rubric, bytes, packet, labels }
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
				if (!matchesSystemError(error, 'EEXIST')) throw error
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
		return computeStudyInstrumentDigest(
			hashStudyBytes(await readStudyBytes(this.#entry, STUDY_CUSTODY_BYTES)),
			new ArtifactLoader({
				entries: [this.#entry],
				roots: [resolveStudyInstrument(this.#entry)],
			}).inspect().digest,
		)
	}
}
