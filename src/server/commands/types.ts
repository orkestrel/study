import type {
	StudyDefinition,
	StudyEvidence,
	StudyFailure,
	StudyAssessment,
	StudyIdentity,
	StudyKeyedSource,
	StudyProfile,
	StudyRole,
	StudyRubric,
	StudyScenario,
	StudyAncestor,
	StudyRange,
	StudySeed,
	StudySelection,
	StudyTrial,
} from '@src/core'
import type { JSONValue } from '@orkestrel/contract'
import type { StudyArtifactLoader } from '../processes/StudyArtifactLoader.js'
import type { StudyPacketBundle, StudySealedResult } from '../stores/types.js'
import type { StudyExchangeDestination } from '../stores/types.js'
import type { ArtifactClosure } from '../artifacts/types.js'
import type { StudyOllamaKeyedSelection, StudyOllamaReplaySelection } from '../ollama/types.js'

/** Holds the trusted application entry and repository location. */
export interface StudyCommandOptions {
	readonly root: string
	readonly entry: string
}

/** Supplies the resolved provider, trial population, workspace, and execution cancellation. */
export interface StudyDaemonSessionOptions {
	readonly profile: StudyProfile
	readonly scenarios: readonly StudyScenario[]
	readonly workspace: string
	readonly signal: AbortSignal
}

/** Supplies one reserved sidecar and its complete maintenance declaration. */
export interface StudyDaemonTrialOptions {
	readonly destination: StudyExchangeDestination
	readonly signal: AbortSignal
}

/** Selects the study a command reads and the profile it reads it under. */
export interface StudyTargetSelector {
	readonly target: string
	readonly profile: string
}

/** Selects the segment of a declared population an execution runs: one trial, a goal range, and a seed. */
export interface StudyExecutionSelector {
	/** Selects one scheduled trial by its id. */
	readonly trial?: string
	/** Projects every selected scenario to an inclusive goal range. */
	readonly goals?: StudyRange
	/** Opens the selected trial from a sealed source's checkpoint row. */
	readonly seed?: StudySeedSelection
}

/** Holds a checked execution selection with optional output custody. */
export interface StudyExecutionRequest extends StudyTargetSelector, StudyExecutionSelector {
	readonly command: 'check' | 'execute'
	/** Selects an absolute output or a portable path contained by the consumer root. */
	readonly out: string | undefined
	readonly expected: string | undefined
	/** Selects a published closure directory, reverified before captured validation and execution. */
	readonly closure?: string
	/** Selects sealed exchanges and explicit trial prefixes before any dependent worker or daemon. */
	readonly replay?: StudyOllamaReplaySelection
	/** Serves listed roles' requests from a sealed recording by their exact bytes. */
	readonly keyed?: StudyOllamaKeyedSelection
	/** Extends a sealed open recording with a strict continuation of every scenario's goals. */
	readonly extend?: string
}

/** Names the sealed source result, source trial, and goal whose checkpoint row seeds an execution. */
export interface StudySeedSelection {
	readonly result: string
	readonly trial: string
	readonly goal: string
}

/** Holds a verified seed record and the checkpoint row value handed to the driver. */
export interface StudySeedResult {
	readonly seed: StudySeed
	readonly value: JSONValue
}

/**
 * Holds an execution's resolved selection with its projected population and seed value.
 * @remarks
 * `scenarios` and `schedule` equal the full declaration when `selection` is undefined; `seed` is
 * the checkpoint row value the selected trial opens from, undefined when it opens fresh.
 */
export interface StudySegment {
	readonly scenarios: readonly StudyScenario[]
	readonly schedule: readonly StudyTrial[]
	readonly selection: StudySelection | undefined
	readonly seed: JSONValue | undefined
}

/** Holds an admitted continuation's derived replay selection and immediate sealed ancestor. */
export interface StudyContinuation {
	readonly replay: StudyOllamaReplaySelection
	readonly ancestor: StudyAncestor
}

/** Requests exclusive materialization and captured validation before publishing closure.json. */
export interface StudyFreezeRequest extends StudyTargetSelector {
	readonly command: 'freeze'
	/** Names the absent absolute destination supplied by --to. */
	readonly destination: string
}

/** Publishes a validated closure with relocated command inputs and execution provenance.
 * @remarks
 * Freeze writes this value as closure.json exclusively only after a fresh captured check and
 * verification of both source and destination. Root and entry are relocated canonical paths;
 * target and profile retain their command selectors. Source is the pre-copy execution identity,
 * identity is the checked relocated identity, and fingerprint is the relocated check result.
 * Closure.json is a publication marker outside the copied-member census, never an admitted
 * executable or source asset. Its sole permitted presence must not hide any other addition.
 */
export interface StudyClosure {
	readonly closure: ArtifactClosure
	readonly root: string
	readonly entry: string
	readonly target: string
	readonly profile: string
	readonly source: StudyIdentity
	readonly identity: StudyIdentity
	readonly fingerprint: string
}

/** Holds an offline predicate grading request. */
export interface StudyGradeRequest {
	readonly command: 'grade'
	readonly target: string
	readonly rubric: string
}

/** Holds an imported-label grading request. */
export interface StudyLabelRequest {
	readonly command: 'label'
	readonly target: string
	readonly assessment: string
	readonly labels: string
}

/** Holds a selected immutable report request. */
export interface StudyReportRequest {
	readonly command: 'report'
	readonly target: string
	readonly assessment: string
}

/** Holds a read-only progress request over a live or sealed result. */
export interface StudyProgressRequest {
	readonly command: 'progress'
	readonly target: string
	/** Names the first goal each trial lists; undefined lists each trial's last goal. */
	readonly from: string | undefined
}

/** Holds a read-only history request over the results under one directory. */
export interface StudyHistoryRequest {
	readonly command: 'history'
	/** Selects the directory as a result selector does: a name under `tmp/studies`, a root-relative path, or an absolute path. */
	readonly target: string
}

/** Names the independently dispatched study command operation. */
export type StudyCommandRequest =
	| StudyExecutionRequest
	| StudyFreezeRequest
	| StudyGradeRequest
	| StudyLabelRequest
	| StudyReportRequest
	| StudyProgressRequest
	| StudyHistoryRequest

/**
 * Holds one role's live calls and their summed duration, or a reading of each.
 * @remarks
 * `T` is a number for one execution and a {@link StudySpread} across the results of one identity.
 */
export interface StudyRoleCost<T = number> {
	readonly role: StudyRole
	readonly calls: T
	readonly duration: T
}

/**
 * Holds what one execution spent: its wall time and each role's live calls and duration in milliseconds.
 * @remarks
 * `duration` sums the terminal attempts' durations, as the report's `costs.duration` does. `roles`
 * lists every role in `STUDY_ROLES` order and counts only requests no recording served, as the
 * report's `costs.roles` does. `T` is a number for one execution and a {@link StudySpread} across
 * the results of one identity.
 */
export interface StudyCost<T = number> {
	readonly duration: T
	readonly roles: ReadonlyArray<StudyRoleCost<T>>
}

/** Holds the minimum, median, and maximum of a set of readings. */
export interface StudySpread {
	readonly minimum: number
	readonly median: number
	readonly maximum: number
}

/**
 * Holds one sealed result's row in its identity's history.
 * @remarks
 * `result` is the manifest's id and `path` the result directory. `difference` subtracts the
 * preceding result's cost from this one's, field by field, and is undefined for the identity's
 * first result.
 */
export interface StudyHistoryEntry {
	readonly result: string
	readonly path: string
	readonly created: string
	readonly seal: string
	readonly cost: StudyCost
	readonly difference: StudyCost | undefined
}

/**
 * Holds the sealed results of one execution identity in creation order, their spread, and the estimate.
 * @remarks
 * `fingerprint` is the `computeStudyCommandFingerprint` digest of the manifest's identity, bounds,
 * definition, the seal of its replayed or extended source, and its selection, so a fresh or
 * extended execution's equals the fingerprint `study check` returned for it. `keyed` names the
 * recording a keyed replay served from, which also separates identities. A seal records no time,
 * so `results` follow the manifests' `created` order, which is seal order for executions that do
 * not overlap. `spread` is undefined below two results, and `estimate` is the last result's wall
 * time.
 */
export interface StudyHistoryIdentity {
	readonly fingerprint: string
	readonly identity: StudyIdentity
	readonly ancestor: StudyAncestor | undefined
	readonly keyed: StudyKeyedSource | undefined
	readonly results: readonly StudyHistoryEntry[]
	readonly spread: StudyCost<StudySpread> | undefined
	readonly estimate: number
}

/** Holds one bounded source artifact retained during offline validation. */
export interface StudyCommandArtifact {
	readonly path: string
	readonly digest: string
}

/**
 * Holds one failed record the report groups by cause, role, and layer.
 * @remarks
 * `trial` names the trial the failure belongs to. `goal` names the goal at the goal level and is
 * undefined at the trial level. `executed` is the record's own execution fact, never inferred.
 */
export interface StudyAttributionSource {
	readonly trial: string
	readonly goal: string | undefined
	readonly failure: StudyFailure
	readonly executed: boolean
}

/** Holds a sealed result's verified evidence rows keyed by scheduled trial id. */
export type StudyEvidenceTable = Readonly<Record<string, readonly StudyEvidence[]>>

/**
 * Holds the sealed source a replay served requests from, with the evidence rows its seal verified.
 * @remarks
 * `result` is the source that a keyed replay's `keyed` member or a prefix replay's `ancestor` member
 * names.
 */
export interface StudyReportSource {
	readonly result: StudySealedResult
	readonly evidence: StudyEvidenceTable
}

/** Holds a parsed study declaration with its driver bundle, scenarios, scenario fixtures, and rubric. */
export interface StudyDeclaration {
	readonly bundle: string
	readonly definition: StudyDefinition
	readonly scenarios: readonly StudyScenario[]
	readonly fixtures: readonly StudyCommandArtifact[]
	readonly rubric: StudyRubric
}

/** Holds the study bundle, its definition, and the resolved profile whose members a freeze copies. */
export interface StudyFreezeInput {
	readonly bundle: string
	readonly definition: StudyDefinition
	readonly profile: StudyProfile
}

/** Holds checked public declarations and reproducible executable identities. */
export interface StudyPreparation {
	readonly bundle: string
	readonly definition: StudyDefinition
	readonly scenarios: readonly StudyScenario[]
	readonly rubric: StudyRubric
	readonly profile: StudyProfile
	readonly identity: StudyIdentity
	readonly artifacts: StudyArtifactLoader
	readonly source: string
	/** Carries the verified closure publication when preparation uses relocated inputs. */
	readonly closure?: StudyClosure
}

/** Holds artifacts already verified inside a selected immutable grading directory. */
export interface StudyAssessmentContext {
	readonly assessment: StudyAssessment
	readonly rubric: StudyRubric
	readonly bytes: Uint8Array
	readonly packet: StudyPacketBundle | undefined
	readonly labels: Uint8Array | undefined
}
