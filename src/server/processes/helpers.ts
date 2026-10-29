import type { StudyFailure, StudyProfile, StudyTrial, StudyScenario } from '@src/core'
import type {
	StudyExchangeDeclaration,
	StudyExchangeDestination,
	StudyExchangeHistory,
	StudyExchangeAncestor,
} from '../stores/types.js'
import type { StudyOllamaReplaySelection } from '../ollama/types.js'
import type { JSONValue } from '@orkestrel/contract'
import type { ChildProcess } from 'node:child_process'
import { StudyError } from '@src/core'
import { canonicalStringify, isJSONValue, isRecord } from '@orkestrel/contract'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { hashStudyBytes, matchesSystemError } from '../helpers.js'
import { STUDY_DRAIN_DURATION } from './constants.js'
import { buildStudyOllamaModels } from '../ollama/helpers.js'
import { isStudyOllamaMetadata } from '../ollama/validators.js'
import { readStudyExchanges, readStudyResult } from '../stores/helpers.js'
import { isStudyExchangeDeclaration } from '../stores/validators.js'
import { isStudyExchangeDestination, isStudyReplaySelection } from './validators.js'

/** Builds the parent's single recording declaration from its profile, trial and scenario.
 * @param profile - The validated executing profile.
 * @param trial - The scheduled trial identity.
 * @param scenario - The trial's complete ordered goal horizon.
 * @param maintenance - If true, declares the execution-owned daemon's models; if false, declares no maintenance.
 * @param ancestor - The sealed replay source and selected exchange prefix, when replaying.
 * @returns A validated opening row, with no inferred metadata or replay allowance.
 */
export function buildStudyExchangeDeclaration(
	profile: StudyProfile,
	trial: StudyTrial,
	scenario: StudyScenario,
	maintenance: boolean,
	ancestor?: StudyExchangeAncestor,
): StudyExchangeDeclaration {
	if (profile.provider === undefined || profile.settings === undefined)
		throw new StudyError('CONFIG', 'Recording requires provider and explicit wire declarations')
	if (scenario.id !== trial.scenario)
		throw new StudyError('CONFIG', 'Recording scenario differs from its trial')
	const declaration = {
		phase: 'declaration',
		trial: trial.id,
		version: profile.settings.version,
		metadata: profile.settings.metadata,
		procedure: profile.settings.procedure,
		models: buildStudyOllamaModels(profile.provider),
		record: profile.record,
		goals: scenario.goals.map((goal) => goal.id),
		configuration: computeStudyConfigurationDigest(profile),
		maintenance: maintenance ? (profile.provider.daemon?.models ?? []) : [],
		...(ancestor === undefined ? {} : { ancestor }),
	}
	if (!isStudyExchangeDeclaration(declaration))
		throw new StudyError(
			'CONFIG',
			'Recording requires valid bounds, goals, version, metadata and optional procedure settings',
		)
	return declaration
}

/** Binds room, driver settings and daemon configuration independently of paths and resource ceilings.
 * @param profile - The executing profile.
 * @returns The canonical configuration's SHA-256 digest.
 */
export function computeStudyConfigurationDigest(profile: StudyProfile): string {
	const { executable: _executable, ...daemon } = profile.provider?.daemon ?? {}
	return hashStudyBytes(
		canonicalStringify(
			valueToWire({
				room: profile.room,
				settings: profile.settings,
				daemon: profile.provider?.daemon === undefined ? undefined : daemon,
			}),
		) ?? '',
	)
}

/** Checks the parent's declaration against the profile, trial and optional scenario held by a reader.
 * @param declaration - The parent's single opening row.
 * @param profile - The reader's executing profile.
 * @param trial - The reader's scheduled trial.
 * @param scenario - The complete horizon when the reader holds it.
 * @returns Nothing after checking every member the reader can independently verify.
 */
export function validateStudyCaptureDeclaration(
	declaration: StudyExchangeDeclaration,
	profile: StudyProfile,
	trial: StudyTrial,
	scenario?: StudyScenario,
): void {
	if (
		!isStudyExchangeDeclaration(declaration) ||
		profile.provider === undefined ||
		declaration.trial !== trial.id ||
		declaration.version !== profile.settings?.version ||
		canonicalStringify(declaration.metadata) !== canonicalStringify(profile.settings?.metadata) ||
		canonicalStringify(declaration.procedure) !== canonicalStringify(profile.settings?.procedure) ||
		canonicalStringify(declaration.models) !==
			canonicalStringify(buildStudyOllamaModels(profile.provider)) ||
		canonicalStringify(declaration.record) !== canonicalStringify(profile.record) ||
		declaration.configuration !== computeStudyConfigurationDigest(profile) ||
		(scenario !== undefined &&
			(scenario.id !== trial.scenario ||
				canonicalStringify(declaration.goals) !==
					canonicalStringify(scenario.goals.map((goal) => goal.id)))) ||
		(declaration.maintenance.length !== 0 &&
			canonicalStringify(declaration.maintenance) !==
				canonicalStringify(profile.provider.daemon?.models))
	)
		throw new StudyError(
			'CONFIG',
			'Recording declaration differs from the executing profile or trial',
		)
}

/** Validates parent preparation output without permitting a destination or allowance substitution.
 * @param original - The parent-reserved destination, or undefined without recording.
 * @param prepared - The callback's retained destination.
 * @returns The validated destination for the worker.
 */
export function readStudyPreparedDestination(
	original: StudyExchangeDestination | undefined,
	prepared: StudyExchangeDestination | undefined,
): StudyExchangeDestination | undefined {
	if (
		original === undefined
			? prepared !== undefined
			: !isStudyExchangeDestination(prepared) ||
				prepared.path !== original.path ||
				canonicalStringify(prepared.declaration) !== canonicalStringify(original.declaration)
	)
		throw new StudyError('CUSTODY', 'Trial preparation changed its reserved destination')
	return prepared
}

/** Rechecks the sealed source and this trial's prefix under the executing profile declaration.
 * @param selection - The explicit sealed source and offline behavior.
 * @param profile - The executing profile, whose bounds remain authoritative.
 * @param trial - The trial whose history must be present.
 * @param declaration - The worker's executing declaration, when available.
 * @returns Complete verified history before any dependent sender or worker starts.
 */
export async function readStudyReplayHistory(
	selection: StudyOllamaReplaySelection,
	profile: StudyProfile,
	trial: StudyTrial,
	declaration?: StudyExchangeDeclaration,
): Promise<StudyExchangeHistory> {
	if (!isStudyReplaySelection(selection)) throw new StudyError('CONFIG', 'Invalid replay selection')
	if (
		profile.provider === undefined ||
		typeof profile.settings?.version !== 'string' ||
		profile.settings.version.length === 0 ||
		!isStudyOllamaMetadata(profile.settings.metadata)
	)
		throw new StudyError('CONFIG', 'Recording requires valid version and metadata settings')
	const result = await readStudyResult(selection.result)
	if (result.status !== 'sealed') throw new StudyError('CUSTODY', 'Replay requires a sealed result')
	const history = await readStudyExchanges(result, trial.id)
	const prefix = selection.prefix[trial.id]
	if (
		prefix === undefined ||
		prefix > history.exchanges.length ||
		(selection.offline && prefix !== history.exchanges.length)
	)
		throw new StudyError('CONFIG', 'Replay prefix does not cover its declared trial')
	if (
		declaration !== undefined &&
		(declaration.ancestor === undefined ||
			declaration.ancestor.prefix !== prefix ||
			declaration.ancestor.result !== result.manifest.id ||
			declaration.ancestor.seal !== history.seal ||
			canonicalStringify(declaration.ancestor.identity) !==
				canonicalStringify(result.manifest.identity) ||
			canonicalStringify(declaration.ancestor.file) !== canonicalStringify(history.file) ||
			canonicalStringify(history.declaration.goals) !==
				canonicalStringify(declaration.goals.slice(0, history.declaration.goals.length)))
	)
		throw new StudyError('CONFIG', 'Worker replay ancestor differs from its selection or horizon')
	if (
		!selection.offline &&
		(history.exchanges[prefix - 1]?.attempt.stage === 'postflight' ||
			history.exchanges[prefix]?.attempt.stage === 'preflight' ||
			prefix <= history.declaration.maintenance.length)
	)
		throw new StudyError(
			'CONFIG',
			'Live replay prefix must end after preflight and before postflight',
		)
	if (
		profile.provider === undefined ||
		history.declaration.version !== profile.settings?.version ||
		canonicalStringify(history.declaration.procedure) !==
			canonicalStringify(profile.settings?.procedure) ||
		canonicalStringify(history.declaration.models) !==
			canonicalStringify(buildStudyOllamaModels(profile.provider))
	)
		throw new StudyError('CONFIG', 'Replay declaration differs from recorded execution')
	return history
}

/** Projects optional domain fields into the JSON wire representation.
 * @param value - An owned domain value with optional undefined fields.
 * @returns A JSON-compatible snapshot.
 * @example Project a wire value
 * ```ts
 * import { valueToWire } from '@orkestrel/study/server'
 *
 * valueToWire({ state: 'ready', failure: undefined }) // { state: 'ready' }
 * ```
 */
export function valueToWire(value: unknown): JSONValue {
	const parsed: unknown = JSON.parse(JSON.stringify(value))
	if (!isJSONValue(parsed)) throw new StudyError('FAULT', 'Invalid study wire value')
	return parsed
}

/** Creates attributable protocol infrastructure failure.
 * @param message - The refused operation or broken boundary.
 * @returns A domain failure that never awards task credit.
 */
export function createStudyProcessFailure(message: string): StudyFailure {
	return { cause: 'infrastructure', message, role: undefined, stop: undefined }
}

/** Binds the canonical fully resolved execution profile carried over IPC.
 * @param profile - The resolved execution settings, with optional absent leaves.
 * @returns The SHA256 digest of the canonical JSON wire representation.
 */
export function computeStudyProfileDigest(profile: StudyProfile): string {
	const encoded = canonicalStringify(valueToWire(profile))
	if (encoded === undefined) throw new StudyError('CONFIG', 'Study profile is not JSON-compatible')
	return hashStudyBytes(encoded)
}

/** Collects the executable entries a profile selects, each canonical path once.
 * @param profile - The resolved execution profile.
 * @returns The agent, subject, and provider entries without repeating a shared entry.
 * @remarks The declared roles stay separate in the profile; only capture and loading deduplicate.
 */
export function collectStudyEntries(profile: StudyProfile): readonly string[] {
	return [
		...new Set([
			profile.agent,
			profile.subject,
			...(profile.provider === undefined ? [] : [profile.provider.entry]),
		]),
	]
}

/** Computes the instrument identity binding trusted runtime bytes to the adapter inventory.
 * @param entry - The SHA-256 identity of the trusted runtime entry bytes.
 * @param inventory - The captured adapter inventory digest.
 * @returns The identity that validation, assessment, and trial children must share.
 */
export function computeStudyInstrumentDigest(entry: string, inventory: string): string {
	return hashStudyBytes(JSON.stringify([entry, inventory]))
}

/** Resolves the actual host package from its trusted executable entry.
 * @param entry - The runtime's own executable, never a consumer-supplied module.
 * @returns The canonical study package root.
 */
export function resolveStudyInstrument(entry: string): string {
	const root = collectStudyAncestors(dirname(realpathSync(entry))).find((directory) => {
		const manifest = join(directory, 'package.json')
		if (!existsSync(manifest)) return false
		const value: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
		return isRecord(value) && value.name === '@orkestrel/study'
	})
	if (root === undefined) throw new StudyError('CONFIG', 'Cannot locate the study runtime package')
	return root
}

/** Reads the version of the study package that owns an executable entry.
 * @param entry - The installed runtime's executable entry.
 * @returns The non-empty version declared by the owning study package.
 * @throws StudyError - Thrown when no study package owns the entry or its version is absent or empty.
 * @example Read the installed version
 * ```ts
 * import { readStudyVersion } from '@orkestrel/study/server'
 *
 * declare const entry: string
 * readStudyVersion(entry)
 * ```
 */
export function readStudyVersion(entry: string): string {
	const value: unknown = JSON.parse(
		readFileSync(join(resolveStudyInstrument(entry), 'package.json'), 'utf8'),
	)
	if (!isRecord(value) || typeof value.version !== 'string' || value.version.length === 0)
		throw new StudyError('CONFIG', 'Study runtime package declares no version')
	return value.version
}

/** Collects a directory and each of its ancestors up to the filesystem root, nearest first.
 * @param directory - The absolute directory to start from.
 * @returns The directory followed by every parent directory, ending at the root.
 */
export function collectStudyAncestors(directory: string): readonly string[] {
	const parent = dirname(directory)
	return parent === directory ? [directory] : [directory, ...collectStudyAncestors(parent)]
}

/** Refuses a profile that omits the actual host runtime's declared dependency bytes.
 * @param instrument - The canonical package owning the trusted runtime entry.
 * @param roots - Explicitly admitted package roots, including the instrument.
 */
export function validateStudyRuntime(instrument: string, roots: readonly string[]): void {
	const pending = [instrument]
	const visited = new Set<string>()
	while (pending.length > 0) {
		const root = pending.pop()
		if (root === undefined || visited.has(root)) continue
		visited.add(root)
		if (!roots.includes(root))
			throw new StudyError('CONFIG', `Profile roots omit a runtime dependency: ${root}`)
		const manifest = join(root, 'package.json')
		const value: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
		if (!isRecord(value) || value.dependencies === undefined) continue
		if (!isRecord(value.dependencies))
			throw new StudyError('CONFIG', 'Runtime dependency declarations are invalid')
		const resolver = createRequire(manifest)
		for (const dependency of Object.keys(value.dependencies))
			pending.push(dirname(realpathSync(resolver.resolve(`${dependency}/package.json`))))
	}
}

/** Releases inherited output handles a bounded time after native exit.
 * @param child - A newly spawned child, subscribed before native exit.
 * @remarks A descendant that outlives an exited root is outside discoverable-tree cleanup; this only stops the parent from waiting on its pipes.
 */
export function drainStudyChild(child: ChildProcess): void {
	const closed = new AbortController()
	child.once('exit', () => {
		// A close before the allowance ends aborts the wait, which is the only rejection it can have.
		void delay(STUDY_DRAIN_DURATION, undefined, { signal: closed.signal }).then(
			() => {
				child.stdout?.destroy()
				child.stderr?.destroy()
			},
			() => undefined,
		)
	})
	child.once('close', () => closed.abort())
}

/** Terminates the recorded native process tree under a finite cleanup allowance.
 * @param child - The exclusively owned child process.
 */
export function terminateStudyChild(child: ChildProcess): void {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
	try {
		if (process.platform === 'win32')
			execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
				windowsHide: true,
				timeout: 2000,
				stdio: 'ignore',
			})
		else {
			const rows = execFileSync('ps', ['-eo', 'pid=,ppid='], {
				timeout: 2000,
				encoding: 'utf8',
				maxBuffer: 1024 * 1024,
			})
				.trim()
				.split(/\r\n|\n/)
				.map((row) => row.trim().split(/\s+/).map(Number))
			const descendants = new Set([child.pid])
			// One pass per row bounds the depth of any parent chain the table can hold.
			rows.forEach(() => {
				for (const [pid, parent] of rows)
					if (pid !== undefined && parent !== undefined && descendants.has(parent))
						descendants.add(pid)
			})
			for (const pid of [...descendants].reverse()) {
				try {
					process.kill(pid, 'SIGKILL')
				} catch (error) {
					if (!matchesSystemError(error, 'ESRCH')) throw error
				}
			}
		}
	} catch (error) {
		try {
			process.kill(child.pid, 0)
		} catch (status) {
			if (matchesSystemError(status, 'ESRCH')) return
			throw status
		}
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL')
			throw error
		}
	}
}
