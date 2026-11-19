import type {
	StudyAttempt,
	StudyAllowance,
	StudyDefinition,
	StudyEvidence,
	StudyAssessment,
	StudyIdentity,
	StudyLabelSheet,
	StudyManifest,
	StudyObservation,
	StudyProfile,
	StudyRubric,
	StudyScenario,
	StudySelection,
} from '@src/core'
import type { StudyAttributionSource, StudyCommandArtifact, StudyDeclaration } from './types.js'
import type {
	StudyClosure,
	StudyEvidenceTable,
	StudyFreezeInput,
	StudyReportSource,
	StudySeedResult,
	StudyTargetSelector,
} from './types.js'
import type { ArtifactClosure, ArtifactLoaderOptions } from '../artifacts/types.js'
import type { StudySealedCustody, StudySealedResult } from '../stores/types.js'
import type { JSONValue } from '@orkestrel/contract'
import {
	STUDY_CAUSES,
	STUDY_LAYERS,
	STUDY_ROLES,
	StudyError,
	computeStudyScores,
	studyStopToJSON,
	parseStudyDefinition,
	parseStudyScenario,
	parseStudyRubric,
} from '@src/core'
import {
	isFiniteNumber,
	isNonEmptyString,
	isNonNegativeNumber,
	isRecord,
	isString,
	parseJSON,
	parseStringField,
} from '@orkestrel/contract'
import { lstat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import {
	containsArtifact,
	decodeStudyJSON,
	encodeStudyJSON,
	hashStudyBytes,
	matchesSystemError,
} from '../helpers.js'
import { readStudyBytes } from '../stores/helpers.js'
import { isStudyCustodyEvidence } from '../stores/validators.js'
import { STUDY_CUSTODY_BYTES, STUDY_RESERVED_NAME } from '../stores/constants.js'
import { readArtifact, verifyArtifactClosure, relocateArtifactPath } from '../artifacts/helpers.js'
import { collectStudyEntries, resolveStudyInstrument, valueToWire } from '../processes/helpers.js'
import { STUDY_CHECKPOINT_EVENT, STUDY_PLACEMENT_OPTIONS } from './constants.js'
import { isStudyClosure } from './validators.js'

/**
 * Selects the loader options the `study freeze` command copies for one study and profile: entries, roots, adapter source, runtime, and assets.
 * @param root - The consumer root that holds `studies`
 * @param entry - The Study executable entry
 * @param request - The study name and profile name
 * @param preparation - The resolved bundle, definition, and profile
 * @returns The options an `ArtifactLoader` inspects and materializes
 * @throws StudyError - Thrown when no Study package owns the entry or a declaration path is malformed or resolves outside its directory
 * @example Select the freeze members
 * ```ts
 * import type { StudyFreezeInput } from '@orkestrel/study/server'
 * import { ArtifactLoader, buildStudyFreezeOptions } from '@orkestrel/study/server'
 *
 * declare const root: string
 * declare const entry: string
 * declare const preparation: StudyFreezeInput
 * const request = { target: 'assessment', profile: 'local' }
 * new ArtifactLoader(buildStudyFreezeOptions(root, entry, request, preparation)).inspect()
 * ```
 */
export function buildStudyFreezeOptions(
	root: string,
	entry: string,
	request: StudyTargetSelector,
	preparation: StudyFreezeInput,
): ArtifactLoaderOptions {
	const instrument = resolveStudyInstrument(entry)
	const directory = resolveStudyPath(join(root, 'studies'), request.target)
	return {
		entries: collectStudyEntries(preparation.profile),
		roots: [...new Set([...preparation.profile.roots, instrument])],
		source: { root: preparation.bundle, entry: join(preparation.bundle, 'index.ts') },
		instrument,
		assets: [
			...new Set([
				entry,
				join(directory, 'study.json'),
				resolveStudyPath(directory, preparation.definition.rubric),
				resolveStudyPath(preparation.bundle, `profiles/${request.profile}.json`),
				...preparation.definition.scenarios.map((id) =>
					resolveStudyPath(preparation.bundle, `scenarios/${id}.json`),
				),
			]),
		],
	}
}

/** Reads and independently verifies an exclusively published closure.
 * @param directory - The canonical closure destination.
 * @returns The verified publication and its copied physical forest.
 * @throws StudyError - Thrown when publication or its command inputs are invalid.
 * @example
 * ```ts
 * declare const directory: string
 * readStudyClosure(directory).fingerprint // the relocated check result the freeze published
 * ```
 */
export function readStudyClosure(directory: string): StudyClosure {
	const marker = readArtifact(join(directory, 'closure.json'), STUDY_CUSTODY_BYTES)
	const value = decodeStudyJSON(marker.source)
	if (!isStudyClosure(value) || value.closure.destination !== directory)
		throw new StudyError('CONFIG', 'Study closure publication is invalid')
	verifyArtifactClosure(value.closure, true)
	if (
		(value.root !== directory && !containsArtifact(directory, value.root)) ||
		!value.closure.members.some(
			(member) => resolve(directory, ...member.key.split('/')) === value.entry,
		)
	)
		throw new StudyError('CONFIG', 'Study closure command inputs leave the copied forest')
	if (readArtifact(join(directory, 'closure.json'), STUDY_CUSTODY_BYTES).digest !== marker.digest)
		throw new StudyError('FAULT', 'Study closure publication changed while reading')
	return value
}

/** Resolves a profile path through a retained physical relocation when selected.
 * @param root - The active consumer root.
 * @param path - The profile's absolute or consumer-relative selection.
 * @param closure - The optional verified physical forest.
 * @returns The active canonical selection.
 * @example
 * ```ts
 * import { join } from 'node:path'
 *
 * declare const root: string
 * resolveStudyClosurePath(root, 'dist/index.js') === join(root, 'dist', 'index.js') // true without a closure
 * ```
 */
export function resolveStudyClosurePath(
	root: string,
	path: string,
	closure?: ArtifactClosure,
): string {
	const absolute = resolve(root, path)
	return closure === undefined ||
		absolute === closure.destination ||
		containsArtifact(closure.destination, absolute)
		? absolute
		: relocateArtifactPath(closure, absolute)
}

/** Reads one declaration file and refuses a missing or linked path with its root-relative path.
 * @param root - The consumer root used to describe a missing or linked declaration.
 * @param path - The already resolved and contained declaration path.
 * @returns The exact declaration bytes under the custody metadata allowance.
 * @throws StudyError - Thrown with code `CONFIG` when the path is missing or linked; other custody refusals retain their codes.
 * @example Read declaration bytes
 * ```ts
 * import { readStudyDeclarationBytes } from '@orkestrel/study/server'
 *
 * declare const root: string
 * declare const path: string
 * await readStudyDeclarationBytes(root, path)
 * ```
 */
export async function readStudyDeclarationBytes(root: string, path: string): Promise<Uint8Array> {
	try {
		const absolute = resolve(path)
		const origin = parse(absolute).root
		const names = relative(origin, absolute).split(sep).filter(Boolean)
		// Classify consumer input before custody admission without traversing a linked ancestor.
		for (const [index] of names.entries()) {
			const candidate = join(origin, ...names.slice(0, index + 1))
			const stat = await lstat(candidate)
			if (stat.isSymbolicLink())
				throw new StudyError(
					'CONFIG',
					`Declaration path is linked: ${relative(root, candidate).split(sep).join('/')}`,
				)
			if (!stat.isDirectory()) break
		}
		return await readStudyBytes(path, STUDY_CUSTODY_BYTES)
	} catch (error) {
		if (matchesSystemError(error, 'ENOENT'))
			throw new StudyError(
				'CONFIG',
				`Declaration is missing: ${relative(root, path).split(sep).join('/')}`,
			)
		throw error
	}
}

/** Reads a study declaration, its driver's scenarios, and its rubric as the command resolves them.
 * @param root - The consumer root containing the studies directory.
 * @param study - The selected study name.
 * @param signal - Optional cancellation checked between scenario reads.
 * @returns The parsed declaration, driver bundle, ordered scenarios, fixtures, and selected rubric.
 * @throws StudyError - Thrown when declarations are missing, invalid, or incompatible.
 * @example Read a study declaration
 * ```ts
 * import type { StudyDeclaration } from '@orkestrel/study/server'
 * import { readStudyDeclaration } from '@orkestrel/study/server'
 *
 * declare const root: string
 * const declaration: StudyDeclaration = await readStudyDeclaration(root, 'assessment')
 * ```
 */
export async function readStudyDeclaration(
	root: string,
	study: string,
	signal?: AbortSignal,
): Promise<StudyDeclaration> {
	const directory = resolveStudyPath(join(root, 'studies'), study)
	const definition = parseStudyDefinition(
		decodeStudyJSON(
			await readStudyDeclarationBytes(root, resolveStudyPath(directory, 'study.json')),
		),
	)
	if (definition.name !== study)
		throw new StudyError('CONFIG', 'Study name differs from its selected directory')
	const bundle = resolveStudyPath(join(root, 'studies'), definition.driver)
	const steps: Array<{ readonly scenario: StudyScenario; readonly fixture: StudyCommandArtifact }> =
		[]
	for (const id of definition.scenarios) {
		signal?.throwIfAborted()
		const path = `scenarios/${id}.json`
		const bytes = await readStudyDeclarationBytes(root, resolveStudyPath(bundle, path))
		const scenario = parseStudyScenario(decodeStudyJSON(bytes))
		if (scenario.id !== id) throw new StudyError('CONFIG', 'Scenario identity is incompatible')
		steps.push({ scenario, fixture: { path, digest: hashStudyBytes(bytes) } })
	}
	const rubric = parseStudyRubric(
		decodeStudyJSON(
			await readStudyDeclarationBytes(root, resolveStudyPath(directory, definition.rubric)),
		),
	)
	return {
		bundle,
		definition,
		scenarios: Object.freeze(steps.map((step) => step.scenario)),
		fixtures: Object.freeze(steps.map((step) => step.fixture)),
		rubric,
	}
}

/**
 * Returns the canonical host form of a drive path written with forward slashes, and every other path as written.
 * @remarks
 * Only a path that opens with a drive letter, a colon, and a forward slash changes: each forward slash becomes the host separator, so a host whose separator is a forward slash returns it as written. A relative path, a UNC path, and a `..` segment pass through unchanged, so the checks that follow refuse them as they refuse the canonical form.
 * @param path - The path as the caller wrote it
 * @returns The path the checks that follow read
 * @example
 * ```ts
 * normalizeStudyPath('C:/work/consumer/tmp/studies/baseline') // 'C:\\work\\consumer\\tmp\\studies\\baseline' on Windows
 * normalizeStudyPath('tmp/studies/baseline') // 'tmp/studies/baseline'
 * ```
 */
export function normalizeStudyPath(path: string): string {
	return /^[A-Za-z]:\//.test(path) ? path.split('/').join(sep) : path
}

/**
 * Resolves a portable relative artifact path strictly inside its selected directory.
 * @param directory - The selected custody or study directory
 * @param path - The slash-separated relative artifact path
 * @returns The contained absolute host path
 * @throws StudyError - Thrown when a path is malformed, reserved, absolute, or resolving outside the
 * selected directory
 * @example
 * ```ts
 * resolveStudyPath(directory, 'profiles/local.json')
 * ```
 */
export function resolveStudyPath(directory: string, path: string): string {
	const names = path.split('/')
	if (
		path === '' ||
		isAbsolute(path) ||
		/[\\<>:"|?*]/.test(path) ||
		Array.from(path).some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) ||
		names.some(
			(name) =>
				name === '' ||
				name === '.' ||
				name === '..' ||
				name.endsWith('.') ||
				name.endsWith(' ') ||
				STUDY_RESERVED_NAME.test(name.split('.')[0] ?? ''),
		)
	)
		throw new StudyError('CONFIG', 'Artifact path must be a portable contained relative path')
	const absolute = resolve(directory, ...names)
	if (!containsArtifact(resolve(directory), absolute))
		throw new StudyError('CONFIG', 'Artifact path escapes its selected directory')
	return absolute
}

/**
 * Resolves the execution profile's caller-selected built artifact paths.
 * @param root - The repository root
 * @param profile - The validated source profile
 * @param closure - The optional verified physical forest used to relocate executable selections
 * @returns The reproducible resolved execution profile, its `qualification` kept as authored
 * @remarks
 * The command resolves `qualification` as a result selector against its own working root, where
 * results are written, never against a closure root.
 * @example
 * ```ts
 * resolveStudyProfile(root, profile)
 * ```
 */
export function resolveStudyProfile(
	root: string,
	profile: StudyProfile,
	closure?: ArtifactClosure,
): StudyProfile {
	const daemon = profile.provider?.daemon
	if (
		daemon !== undefined &&
		(!isAbsolute(daemon.executable) || realpathSync(daemon.executable) !== daemon.executable)
	)
		throw new StudyError('CONFIG', 'Daemon executable must name its canonical absolute path')
	return {
		...profile,
		agent: resolveStudyClosurePath(root, profile.agent, closure),
		subject: resolveStudyClosurePath(root, profile.subject, closure),
		roots: profile.roots.map((path) => resolveStudyClosurePath(root, path, closure)),
		provider:
			profile.provider === undefined
				? undefined
				: {
						...profile.provider,
						entry: resolveStudyClosurePath(root, profile.provider.entry, closure),
					},
	}
}

/**
 * Computes the native supervisor's exact validated execution fingerprint.
 * @param identity - The reproducible executable identities
 * @param bounds - The validated nested execution limits
 * @param definition - The optional full declaration binding supervisor check to execute
 * @param ancestor - The immediate ancestor seal when checking a continuation
 * @param selection - The execute-time segment; undefined keeps the selection-free fingerprint
 * @returns The fingerprint that execute must compare before any writes or child work
 * @example
 * ```ts
 * computeStudyCommandFingerprint(identity, bounds)
 * ```
 */
export function computeStudyCommandFingerprint(
	identity: StudyIdentity,
	bounds: StudyAllowance,
	definition?: StudyDefinition,
	ancestor?: string,
	selection?: StudySelection,
): string {
	return hashStudyBytes(
		encodeStudyJSON({
			identity,
			bounds,
			...(definition === undefined ? {} : { definition }),
			...(ancestor === undefined ? {} : { ancestor }),
			...(selection === undefined ? {} : { selection }),
		}),
	)
}

/**
 * Computes public fixture identity from execution policy and exact scenario bytes.
 * @param definition - The complete retained study declaration
 * @param scenarios - The exact public scenario artifact identities
 * @returns The digest shared by compatible capacity and memory executions
 * @example
 * ```ts
 * computeStudyFixtureDigest(definition, scenarios)
 * ```
 */
export function computeStudyFixtureDigest(
	definition: StudyDefinition,
	scenarios: readonly StudyCommandArtifact[],
): string {
	return hashStudyBytes(
		encodeStudyJSON({
			driver: definition.driver,
			arms: definition.arms,
			order: definition.order,
			retries: definition.retries,
			scenarios,
		}),
	)
}

/**
 * Reads sealed evidence bytes through custody checks without loading executable code.
 * @param result - The independently verified sealed execution's directory, manifest, and seal
 * @returns Evidence records keyed by scheduled trial identity
 * @throws StudyError - Thrown with `CUSTODY` when evidence differs from its seal digest, becomes partial, or fails validation
 * @example
 * ```ts
 * await collectStudyEvidence(result)
 * ```
 */
export async function collectStudyEvidence(
	result: StudySealedCustody,
): Promise<StudyEvidenceTable> {
	const retained: Array<readonly [string, readonly StudyEvidence[]]> = []
	for (const trial of result.manifest.schedule) {
		const path = `trials/${trial.id}/evidence.jsonl`
		const file = result.seal.files.find((entry) => entry.path === path)
		const bytes = await readStudyBytes(
			join(result.directory, 'execution', 'trials', trial.id, 'evidence.jsonl'),
			result.manifest.bounds.trial.bytes,
		)
		if (file === undefined || hashStudyBytes(bytes) !== file.digest)
			throw new StudyError('CUSTODY', 'Evidence changed after execution verification')
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		if (text !== '' && !text.endsWith('\n'))
			throw new StudyError('CUSTODY', 'Evidence is incomplete')
		const rows = text
			.split(/\r\n|\n/)
			.slice(0, -1)
			.map((line): StudyEvidence => {
				const row = parseJSON(line)
				if (!isStudyCustodyEvidence(row)) throw new StudyError('CUSTODY', 'Evidence row is invalid')
				return row
			})
		retained.push([trial.id, Object.freeze(rows)])
	}
	return Object.freeze(Object.fromEntries(retained))
}

/**
 * Reads the one sealed `checkpoint` evidence row a seeded execution opens its trial from.
 * @param result - The independently verified sealed source
 * @param trial - The source trial that wrote the row
 * @param goal - The goal the row names
 * @returns The seed record naming the source, seal, trial, goal, and row digest, with the row value
 * @throws StudyError - Thrown as `CUSTODY` when the trial is unscheduled, its evidence drifted, or it holds no row or several rows for the goal
 * @example
 * ```ts
 * await readStudySeed(result, 'r1-s1-a1', 'g2') // { seed: { result, seal, trial, goal, digest }, value }
 * ```
 */
export async function readStudySeed(
	result: StudySealedResult,
	trial: string,
	goal: string,
): Promise<StudySeedResult> {
	if (!result.manifest.schedule.some((entry) => entry.id === trial))
		throw new StudyError('CUSTODY', 'Seed trial is not scheduled in its source: ' + trial)
	const rows = ((await collectStudyEvidence(result))[trial] ?? []).filter(
		(row) => row.event === STUDY_CHECKPOINT_EVENT && row.goal === goal,
	)
	const [row] = rows
	if (row === undefined || rows.length !== 1)
		throw new StudyError(
			'CUSTODY',
			'Seed source must hold exactly one checkpoint row for trial ' + trial + ' and goal ' + goal,
		)
	return {
		seed: {
			result: result.manifest.id,
			seal: result.seal.id,
			trial,
			goal,
			digest: hashStudyBytes(encodeStudyJSON(row)),
		},
		value: row.value,
	}
}

/**
 * Partitions records by their explicit execution fact without inferring any.
 * @param records - The attempts, observations, or attribution sources to partition
 * @returns Counts of executed and unexecuted records, which sum to the record count
 * @example
 * ```ts
 * computeStudyPartition(attempts) // { executed: 2, unexecuted: 1 }
 * ```
 */
export function computeStudyPartition(
	records: ReadonlyArray<StudyAttempt | StudyObservation | StudyAttributionSource>,
): Readonly<Record<'executed' | 'unexecuted', number>> {
	return {
		executed: records.filter((record) => record.executed).length,
		unexecuted: records.filter((record) => !record.executed).length,
	}
}

/**
 * Groups failed records by cause, role, and layer, each group carrying the stops its records name.
 * @remarks
 * A group exists for each cause, role, and layer that holds at least one record. Groups follow
 * `STUDY_CAUSES`, then `STUDY_ROLES` with an absent role last, then `STUDY_LAYERS` with an absent
 * layer last. `role` and `layer` are null when absent. `executed` and `unexecuted` partition the
 * group by each record's own execution fact. `stops` lists every record of the group that carries a
 * stop, in source order, with `trial`, `goal` at the goal level only, `id`, `max`, and `consumed`
 * (null when the source reported none). A failure sealed before the `stop` member existed groups with
 * a null layer and no stop; the helper infers no layer from a message.
 * @param sources - The failed records, in source order
 * @returns The JSON groups
 * @example
 * ```ts
 * computeStudyAttributions([{ trial: 'r1-s1-a1', goal: undefined, failure, executed: true }])
 * ```
 */
export function computeStudyAttributions(sources: readonly StudyAttributionSource[]): JSONValue {
	return STUDY_CAUSES.flatMap((cause) =>
		[...STUDY_ROLES, undefined].flatMap((role) =>
			[...STUDY_LAYERS, undefined].flatMap((layer) => {
				const group = sources.filter(
					(source) =>
						source.failure.cause === cause &&
						source.failure.role === role &&
						source.failure.stop?.layer === layer,
				)
				if (group.length === 0) return []
				return [
					{
						cause,
						role: role ?? null,
						layer: layer ?? null,
						...computeStudyPartition(group),
						stops: group.flatMap((source) => {
							const stop = source.failure.stop
							return stop === undefined
								? []
								: [
										{
											trial: source.trial,
											...(source.goal === undefined ? {} : { goal: source.goal }),
											...Object.fromEntries(
												Object.entries(studyStopToJSON(stop) ?? {}).filter(
													([key]) => key !== 'layer',
												),
											),
										},
									]
						}),
					},
				]
			}),
		),
	)
}

/**
 * Computes each role's calls and send-to-settlement milliseconds over the `wire` evidence rows.
 * @remarks
 * A role appears when at least one `wire` row names it, in `STUDY_ROLES` order. `calls` counts the
 * role's rows, a served row included. `duration` sums each row's `elapsed` reading, which a row
 * carries when its profile observes, and is absent when any of the role's rows carries none, never 0.
 * @param rows - The evidence rows
 * @returns The JSON role readings
 * @example
 * ```ts
 * computeStudyWireUsage([{ event: 'wire', goal: 'write', value: { role: 'agent', elapsed: 12.5 } }])
 * // [{ role: 'agent', calls: 1, duration: 12.5 }]
 * ```
 */
export function computeStudyWireUsage(rows: readonly StudyEvidence[]): JSONValue {
	const wires = rows.flatMap((row) =>
		row.event === 'wire' && isRecord(row.value) ? [row.value] : [],
	)
	return STUDY_ROLES.flatMap((role) => {
		const values = wires.filter((value) => value.role === role)
		const durations = values.map((value) => value.elapsed)
		return values.length === 0
			? []
			: [
					{
						role,
						calls: values.length,
						...(durations.every(isNonNegativeNumber)
							? { duration: durations.reduce((total, duration) => total + duration, 0) }
							: {}),
					},
				]
	})
}

/**
 * Computes the setup a result ran under from its manifest's host facts and its evidence rows.
 * @remarks
 * `platform` and `architecture` read the manifest's recorded runtime inventory. `daemon.executable`
 * reads the executable path the daemon's startup identity records, and `daemon.versions` lists, in
 * row order, the distinct versions the `version` rows name. Each is absent when unrecorded, and
 * `daemon` is absent when both are. `models` lists each distinct role, model, and placement the
 * `wire` rows sent, where a row's Ollama `options` carry a member `STUDY_PLACEMENT_OPTIONS` names.
 * `roles` holds `computeStudyWireUsage` over the rows.
 * @param manifest - The sealed execution manifest
 * @param rows - The result's evidence rows
 * @returns The JSON setup
 * @example
 * ```ts
 * declare const manifest: StudyManifest
 * computeStudySetup({ ...manifest, host: { platform: 'linux', architecture: 'x64' } }, [])
 * // { platform: 'linux', architecture: 'x64', models: [], roles: [] }
 * ```
 */
export function computeStudySetup(
	manifest: StudyManifest,
	rows: readonly StudyEvidence[],
): JSONValue {
	const { platform, architecture } = manifest.host
	const startup = parseJSON(manifest.host.daemon ?? '')
	const executable = isRecord(startup)
		? parseStringField(startup, ['executable', 'path'])
		: undefined
	const versions = [
		...new Set(
			rows.flatMap((row) =>
				row.event === 'version' && isRecord(row.value) && isNonEmptyString(row.value.version)
					? [row.value.version]
					: [],
			),
		),
	]
	const placed = rows.flatMap((row) => {
		const value = row.event === 'wire' && isRecord(row.value) ? row.value : undefined
		const options = isRecord(value?.options) ? value.options : {}
		const placement = Object.fromEntries(
			STUDY_PLACEMENT_OPTIONS.flatMap((name) => {
				const member = options[name]
				return isFiniteNumber(member) ? [[name, member] as const] : []
			}),
		)
		return value === undefined ||
			!isString(value.role) ||
			!isNonEmptyString(value.model) ||
			Object.keys(placement).length === 0
			? []
			: [{ role: value.role, model: value.model, placement }]
	})
	const models = new Map(placed.map((entry) => [JSON.stringify(entry), entry] as const))
	return {
		...(platform === undefined ? {} : { platform }),
		...(architecture === undefined ? {} : { architecture }),
		...(executable === undefined && versions.length === 0
			? {}
			: {
					daemon: {
						...(executable === undefined ? {} : { executable }),
						...(versions.length === 0 ? {} : { versions }),
					},
				}),
		models: [...models.values()],
		roles: computeStudyWireUsage(rows),
	}
}

/**
 * Computes whole-horizon results with operational costs and repetitions kept distinct.
 * @param result - The verified complete execution
 * @param rubric - The retained compatible rubric
 * @param assessment - The independently verified selected assessment
 * @param evidence - The result's evidence rows its seal verified
 * @param source - The sealed source a replay names, when it was found
 * @returns The JSON report without pooling identities or inventing absent measurements
 * @throws StudyError - Thrown with `CUSTODY` when `source` is not the result and seal the replay recorded
 * @remarks
 * Operations count affected trial and goal records, not independent failure events, and the
 * trial and goal counts overlap and are never added. Completion is operational: a goal is
 * completed when it holds a non-partial product and no failure, and a trial when it holds no
 * failure and every goal completed. It is neither task success nor a qualification gate. Costs
 * state what this execution spent, so a request a recording served counts under `replayed` alone.
 * `setup` holds `computeStudySetup` over the evidence. A result whose manifest names a `keyed` or
 * an `ancestor` source holds `source`: the source's summed trial `duration` and
 * `computeStudyWireUsage` over its rows, so a replay states the live cost it served; without a
 * found source it holds `status: 'absent'`.
 * @example
 * ```ts
 * computeStudyReport(result, rubric, assessment, await collectStudyEvidence(result))
 * ```
 */
export function computeStudyReport(
	result: StudySealedResult,
	rubric: StudyRubric,
	assessment: StudyAssessment,
	evidence: StudyEvidenceTable,
	source?: StudyReportSource,
): JSONValue {
	const origin = result.manifest.keyed ?? result.manifest.ancestor
	if (
		source !== undefined &&
		(source.result.manifest.id !== origin?.result || source.result.seal.id !== origin.seal)
	)
		throw new StudyError('CUSTODY', 'Replay source differs from the seal its replay recorded')
	const scores = computeStudyScores(result.manifest, rubric, assessment)
	const observations = result.attempts.flatMap((attempt) => attempt.observations)
	const usage = observations.flatMap((observation) => observation.usage)
	const spent = usage.filter((entry) => entry.replayed !== true)
	const completed = new Set(
		observations.filter(
			(observation) =>
				observation.product !== undefined &&
				!observation.product.partial &&
				observation.failure === undefined,
		),
	)
	const { schedule, selection } = result.manifest
	const repetitions = [...result.manifest.definition.order.entries()]
		.filter(([repetition]) => schedule.some((trial) => trial.repetition === repetition))
		.map(([repetition, order]) => ({
			repetition,
			order: [...order],
			arms: result.manifest.definition.arms
				.filter((arm) =>
					schedule.some((trial) => trial.repetition === repetition && trial.arm === arm),
				)
				.map((arm) => {
					const trials = new Set(
						result.manifest.schedule
							.filter((trial) => trial.repetition === repetition && trial.arm === arm)
							.map((trial) => trial.id),
					)
					const applicable = result.manifest.schedule
						.filter((trial) => trials.has(trial.id))
						.flatMap((trial) =>
							rubric.criteria
								.filter((criterion) => criterion.scenario === trial.scenario)
								.map((criterion) => ({ trial: trial.id, criterion })),
						)
					const judgments = applicable.map((pair) => ({
						criterion: pair.criterion,
						judgment: assessment.judgments.find(
							(entry) => entry.trial === pair.trial && entry.criterion === pair.criterion.id,
						),
					}))
					const achieved = judgments.filter(
						(entry) => entry.judgment?.verdict === 'achieved',
					).length
					const unsuccessful = judgments.filter(
						(entry) => entry.judgment?.verdict === 'unsuccessful',
					).length
					const unknown = applicable.length - achieved - unsuccessful
					return {
						arm,
						total: applicable.length,
						achieved,
						unsuccessful,
						unknown,
						critical: judgments.filter(
							(entry) => entry.criterion.critical && entry.judgment?.verdict === 'unsuccessful',
						).length,
						lower: achieved / applicable.length,
						upper: (achieved + unknown) / applicable.length,
						coverage: (achieved + unsuccessful) / applicable.length,
					}
				}),
		}))
	const identity = result.manifest.identity
	return {
		command: 'report',
		result: result.manifest.id,
		seal: result.seal.id,
		identity: {
			agent: identity.agent,
			subject: identity.subject,
			instrument: identity.instrument,
			fixtures: identity.fixtures,
			profile: identity.profile,
			...(identity.provider === undefined ? {} : { provider: identity.provider }),
		},
		setup: computeStudySetup(
			result.manifest,
			schedule.flatMap((trial) => evidence[trial.id] ?? []),
		),
		purpose: result.manifest.definition.purpose,
		population:
			selection === undefined
				? 'Complete declared trial and criterion horizon'
				: 'Selected segment of the declared trial and criterion horizon',
		...(selection === undefined
			? {}
			: {
					selection: {
						...(selection.trial === undefined ? {} : { trial: selection.trial }),
						...(selection.goals === undefined ? {} : { goals: { ...selection.goals } }),
						...(selection.seed === undefined ? {} : { seed: { ...selection.seed } }),
					},
				}),
		...(result.manifest.keyed === undefined
			? {}
			: {
					keyed: {
						result: result.manifest.keyed.result,
						seal: result.manifest.keyed.seal,
						roles: [...result.manifest.keyed.roles],
						offline: result.manifest.keyed.offline,
					},
				}),
		...(origin === undefined
			? {}
			: {
					source:
						source === undefined
							? { result: origin.result, seal: origin.seal, status: 'absent' }
							: {
									result: origin.result,
									seal: origin.seal,
									duration: source.result.attempts.reduce(
										(total, attempt) => total + attempt.duration,
										0,
									),
									roles: computeStudyWireUsage(
										source.result.manifest.schedule.flatMap(
											(trial) => source.evidence[trial.id] ?? [],
										),
									),
								},
				}),
		...(assessment.unselected === undefined ? {} : { unselected: [...assessment.unselected] }),
		uncertainty:
			repetitions.length === 1
				? 'One repetition is descriptive and does not establish replicated capacity or quality.'
				: 'Repetitions are retained separately; intervals represent unresolved assessment, not statistical confidence.',
		scores: scores.map((score) => ({ ...score })),
		repetitions,
		operations: {
			trials: {
				scheduled: result.manifest.schedule.length,
				terminal: result.attempts.length,
				...computeStudyPartition(result.attempts),
				completed: result.attempts.filter(
					(attempt) =>
						attempt.failure === undefined &&
						attempt.observations.every((observation) => completed.has(observation)),
				).length,
				faults: STUDY_CAUSES.map((cause) => ({
					cause,
					...computeStudyPartition(
						result.attempts.filter((attempt) => attempt.failure?.cause === cause),
					),
				})),
				attributions: computeStudyAttributions(
					result.attempts.flatMap((attempt) =>
						attempt.failure === undefined
							? []
							: [
									{
										trial: attempt.trial.id,
										goal: undefined,
										failure: attempt.failure,
										executed: attempt.executed,
									},
								],
					),
				),
			},
			goals: {
				scheduled: observations.length,
				...computeStudyPartition(observations),
				products: observations.filter((observation) => observation.product !== undefined).length,
				partial: observations.filter((observation) => observation.product?.partial === true).length,
				completed: observations.filter((observation) => completed.has(observation)).length,
				faults: STUDY_CAUSES.map((cause) => ({
					cause,
					...computeStudyPartition(
						observations.filter((observation) => observation.failure?.cause === cause),
					),
				})),
				attributions: computeStudyAttributions(
					result.attempts.flatMap((attempt) =>
						attempt.observations.flatMap((observation) =>
							observation.failure === undefined
								? []
								: [
										{
											trial: attempt.trial.id,
											goal: observation.goal,
											failure: observation.failure,
											executed: observation.executed,
										},
									],
						),
					),
				),
			},
		},
		costs: {
			duration: result.attempts.reduce((total, attempt) => total + attempt.duration, 0),
			roles: STUDY_ROLES.map((role) => {
				const charges = spent.filter((entry) => entry.role === role)
				return {
					role,
					replayed: usage.filter((entry) => entry.role === role && entry.replayed === true).length,
					measurements: charges.length,
					calls: charges.reduce((total, entry) => total + entry.calls, 0),
					duration: charges.reduce((total, entry) => total + entry.duration, 0),
					tokens: {
						known: charges.reduce((total, entry) => total + (entry.tokens ?? 0), 0),
						unknown: charges.filter((entry) => entry.tokens === undefined).length,
					},
					bytes: {
						known: charges.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
						unknown: charges.filter((entry) => entry.bytes === undefined).length,
					},
				}
			}),
		},
	}
}

/**
 * Computes the labels block a report states beside a labeled assessment.
 * @remarks
 * Without labels the block holds `status: 'absent'`. Otherwise it holds the file's `labeler`,
 * `version`, and `usage`, and, when the file carries control tallies, `controls` with `origin:
 * 'imported'` and each lane's `labeler`, `answered`, and `missed`, because Study holds no control map
 * to check them against.
 * @param labels - The labeled assessment's imported labels, or undefined without any
 * @returns The JSON labels block
 * @example
 * ```ts
 * computeStudyLabelReport(undefined) // { status: 'absent' }
 * ```
 */
export function computeStudyLabelReport(labels: StudyLabelSheet | undefined): JSONValue {
	if (labels === undefined) return { status: 'absent' }
	return {
		labeler: labels.labeler,
		version: labels.version,
		usage: valueToWire(labels.usage),
		...(labels.controls === undefined
			? {}
			: {
					controls: {
						origin: 'imported',
						lanes: labels.controls.map((tally) => ({
							labeler: tally.labeler,
							answered: tally.answered,
							missed: tally.missed,
						})),
					},
				}),
	}
}
