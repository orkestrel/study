import type { JSONValue } from '@orkestrel/contract'

/** Names the evidence a study can establish. */
export type StudyPurpose = 'mechanism' | 'quality' | 'capacity'

/** Names a request's measured responsibility. */
export type StudyRole = 'agent' | 'judge' | 'summary' | 'metadata' | 'tool'

/** Names an operational ending separately from task achievement. */
export type StudyCause = 'capacity' | 'infrastructure' | 'deadline' | 'interrupted'

/** Names malformed configuration, evidence, custody and operational failures. */
export type StudyErrorCode = 'CONFIG' | 'EVIDENCE' | 'CUSTODY' | 'CAPACITY' | 'FAULT' | 'DEADLINE'

/** Holds finite allowances in milliseconds, calls, tokens and bytes. */
export interface StudyLimit {
	readonly duration: number
	readonly calls: number
	readonly tokens: number
	readonly bytes: number
}

/** Holds nested execution allowances; each request also has a deadline. */
export interface StudyBounds {
	readonly request: StudyLimit
	readonly goal: StudyLimit
	readonly trial: StudyLimit
	readonly series: StudyLimit
}

/** Holds a declared goal's public input without its grading truth. */
export interface StudyGoal {
	readonly id: string
	readonly input: JSONValue
}

/** Holds ordered goals sharing state within an isolated trial. */
export interface StudyScenario {
	readonly id: string
	readonly goals: readonly StudyGoal[]
}

/** Holds the frozen study question, population and explicit repetition orders. */
export interface StudyDefinition {
	readonly name: string
	readonly version: string
	readonly question: string
	readonly purpose: StudyPurpose
	readonly driver: string
	readonly arms: readonly string[]
	readonly scenarios: readonly string[]
	readonly order: ReadonlyArray<readonly string[]>
	readonly retries: 0
	readonly rubric: string
}

/** Holds the model context and generation allowance as separate measurements. */
export interface StudyRoom {
	readonly context: number
	readonly output: number
	readonly safety: number
	readonly recap: number
	readonly think: boolean
}

/** Holds caller-selected provider artifacts and model identities. */
export interface StudyProvider {
	readonly entry: string
	readonly url: string
	readonly model: string
	readonly judge: string
	/** Pins the serving inventory independently of mutable model names. */
	readonly digest: {
		readonly model: string
		readonly judge: string
	}
}

/** Holds execution settings independently of scenario and grading declarations. */
export interface StudyProfile {
	readonly name: string
	readonly subject: string
	readonly roots: readonly string[]
	readonly bounds: StudyBounds
	readonly room: StudyRoom
	readonly provider: StudyProvider | undefined
	readonly qualification: string | undefined
	/** Holds driver-owned JSON; the driver owns its interpretation and Study only validates and owns the object. */
	readonly settings: Readonly<Record<string, JSONValue>> | undefined
}

/** Holds a scheduled trajectory, with a fresh state for each repetition and arm. */
export interface StudyTrial {
	readonly id: string
	readonly scenario: string
	readonly arm: string
	readonly repetition: number
}

/** Holds byte identities that qualification and comparisons must agree on. */
export interface StudyIdentity {
	readonly subject: string
	readonly provider: string | undefined
	readonly instrument: string
	readonly fixtures: string
	readonly profile: string
}

/** Holds the execution declaration sealed before any trial begins. */
export interface StudyManifest {
	readonly id: string
	readonly created: string
	readonly definition: StudyDefinition
	readonly scenarios: readonly StudyScenario[]
	readonly identity: StudyIdentity
	readonly schedule: readonly StudyTrial[]
	readonly bounds: StudyBounds
	readonly qualification: string | undefined
	readonly host: Readonly<Record<string, string>>
}

/** Holds an attributable operational fault without awarding a task verdict. */
export interface StudyFailure {
	readonly cause: StudyCause
	readonly message: string
	readonly role: StudyRole | undefined
}

/** Holds a request's pre-dispatch upper bounds. */
export interface StudyCharge {
	readonly role: StudyRole
	readonly tokens: number
	readonly bytes: number
}

/** Holds actual request measurements; absent token usage remains unknown. */
export interface StudyUsage {
	readonly role: StudyRole
	readonly calls: number
	readonly tokens: number | undefined
	readonly bytes: number | undefined
	readonly duration: number
}

/** Holds one admitted request until its actual charge is recorded. */
export interface StudyTicket {
	readonly signal: AbortSignal
	/** Records actual measurements for one admitted request.
	 * @param usage - The request's measured charges.
	 * @returns Nothing after settlement.
	 */
	finish(usage: StudyUsage): void
	/** Records an attributable failure for one admitted request.
	 * @param failure - The retained operational attribution.
	 * @returns Nothing after failure propagation.
	 */
	fail(failure: StudyFailure): void
}

/** Admits requests against enclosing limits before an adapter dispatches them. */
export interface StudyAdmissionInterface {
	readonly signal: AbortSignal
	readonly usage: readonly StudyUsage[]
	/** Resolves admission before dispatch; local meters may return the ticket synchronously. */
	admit(charge: StudyCharge): StudyTicket | Promise<StudyTicket>
}

/** Holds append-only domain evidence in a JSON-compatible form. */
export interface StudyEvidence {
	readonly event: string
	readonly goal: string
	readonly value: JSONValue
}

/** Holds an evidence sink whose implementation owns byte limits and custody. */
export interface StudySinkInterface {
	/** Appends bounded domain evidence to the owned execution record.
	 * @param evidence - The public evidence for a declared goal.
	 * @returns A promise that resolves when custody accepts the bytes.
	 */
	append(evidence: StudyEvidence): Promise<void>
}

/** Holds the resources visible to one running goal. */
export interface StudyContext {
	readonly signal: AbortSignal
	readonly meter: StudyAdmissionInterface
	readonly evidence: StudySinkInterface
}

/** Holds observed output and partial completion, never self-awarded success. */
export interface StudyProduct {
	readonly value: JSONValue
	readonly partial: boolean
}

/** Owns domain state across a trial and releases it before the next trial. */
export interface StudySessionInterface {
	/** Executes one public goal against the trial's retained domain state.
	 * @param goal - The declared public input.
	 * @param context - Cancellation, borrowed admission, and evidence custody.
	 * @returns The observed product without a task verdict.
	 */
	execute(goal: StudyGoal, context: StudyContext): Promise<StudyProduct>
	/** Releases the trial's domain resources.
	 * @returns A promise that resolves after release.
	 */
	close(): Promise<void>
}

/** Creates isolated domain state through a concrete package consumer. */
export interface StudyDriverInterface {
	/** Creates fresh domain state for one scheduled trial.
	 * @param trial - The scheduled scenario, arm, and repetition.
	 * @param signal - The caller's cancellation.
	 * @returns The isolated session for this trial.
	 */
	open(trial: StudyTrial, signal: AbortSignal): Promise<StudySessionInterface>
}

/** Holds the retained outcome of a scheduled goal. */
export interface StudyObservation {
	readonly goal: string
	readonly product: StudyProduct | undefined
	readonly failure: StudyFailure | undefined
	readonly usage: readonly StudyUsage[]
	readonly duration: number
	/** Records whether the engine dispatched the goal to the session; never inferred from product, usage, duration or failure. */
	readonly executed: boolean
}

/** Holds a terminal trial record, including goals never dispatched. */
export interface StudyAttempt {
	readonly trial: StudyTrial
	readonly observations: readonly StudyObservation[]
	readonly failure: StudyFailure | undefined
	readonly duration: number
	/** Records whether the trial entered execution without an inherited terminal series failure, including failures before the driver opened; not a claim that the driver was opened. */
	readonly executed: boolean
}

/** Appends terminal records without overwriting a prior attempt. */
export interface StudyStoreInterface {
	/** Opens append-only evidence custody for one scheduled trial.
	 * @param trial - The exact scheduled trial.
	 * @returns The borrowed evidence sink.
	 */
	start(trial: StudyTrial): Promise<StudySinkInterface>
	/** Retains the terminal record for one scheduled trial.
	 * @param attempt - The complete scheduled goal horizon.
	 * @returns A promise that resolves after custody retains the record.
	 */
	finish(attempt: StudyAttempt): Promise<void>
}

/** Holds the common engine's fixed execution inputs. */
export interface StudySeriesOptions {
	readonly manifest: StudyManifest
	readonly driver: StudyDriverInterface
	readonly store: StudyStoreInterface
	readonly signal: AbortSignal
}

/** Holds a grader-owned criterion outside the driver's public input. */
export interface StudyCriterion {
	readonly id: string
	readonly scenario: string
	readonly goal: string
	readonly method: 'state' | 'trace' | 'semantic'
	readonly critical: boolean
	readonly assertion: JSONValue
}

/** Holds a versioned grading declaration independently of execution. */
export interface StudyRubric {
	readonly version: string
	readonly criteria: readonly StudyCriterion[]
}

/** Holds an evidence-backed verdict; missing evidence stays unknown. */
export interface StudyJudgment {
	readonly trial: string
	readonly criterion: string
	readonly verdict: 'achieved' | 'unsuccessful' | 'unknown'
	readonly method: 'state' | 'trace' | 'human' | 'model'
	readonly reason: string
	readonly references: readonly string[]
}

/** Holds imported semantic judgments and their accountable origin. */
export interface StudyLabels {
	readonly packet: string
	readonly labeler: string
	readonly version: string
	readonly created: string
	readonly usage: readonly StudyUsage[]
	readonly judgments: readonly StudyJudgment[]
}

/** Holds a grading identity that cannot replace or mutate execution bytes. */
export interface StudyGrading {
	readonly result: string
	readonly rubric: string
	readonly grader: string
	readonly instrument: string
	readonly attempts: readonly string[]
	readonly labels: string | undefined
	/** Binds the retained public packet and private mapping when semantic criteria exist. */
	readonly packet?: string
	readonly judgments: readonly StudyJudgment[]
}

/** Holds an arm's whole-horizon counts without hiding unresolved criteria. */
export interface StudyScore {
	readonly arm: string
	readonly total: number
	readonly achieved: number
	readonly unsuccessful: number
	readonly unknown: number
	readonly critical: number
	readonly lower: number
	readonly upper: number
	readonly coverage: number
}
