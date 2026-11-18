import type { StudyBounds, StudyProvider } from '@src/core'
import type { StudyExecutionRequest } from '../commands/types.js'
import type { StudyResultView } from '../stores/types.js'
import type { StudyInstall } from './StudyInstall.js'

/** Selects the native command entry and the caller's consumer root. */
export interface StudyLaunchOptions {
	readonly root: string
	readonly entry: string
}

/** Retains the bounded command exit and the text each captured stream carried. */
export interface StudyLaunchResult {
	readonly code: number
	readonly stdout: string
	readonly stderr: string
}

/**
 * Holds the validated bounds a check reply carries and its execution fingerprint when valid.
 * @example
 * ```ts
 * import type { StudyCheckReply } from '@orkestrel/study/server'
 *
 * declare const reply: StudyCheckReply
 * const allowance = reply.bounds.series.duration
 * const pinned = reply.fingerprint
 * ```
 */
export interface StudyCheckReply {
	readonly bounds: StudyBounds
	readonly fingerprint: string | undefined
}

/**
 * Retains an install command's exit, the text each captured stream carried, and its elapsed milliseconds.
 * @example
 * ```ts
 * import type { StudyInstallResult } from '@orkestrel/study/server'
 *
 * declare const result: StudyInstallResult
 * const expired = result.code === 124
 * const elapsed = result.duration
 * ```
 */
export interface StudyInstallResult extends StudyLaunchResult {
	readonly duration: number
}

/**
 * Selects the consumer root, the absent install directory, the studies and profiles to copy, and an optional provider to rebind.
 * @remarks
 * The `profiles` option defaults to `['local']`. The `provider` option rebinds each listed profile's
 * copy to its URL and digests and drops that profile's daemon.
 * @example
 * ```ts
 * import type { StudyInstallOptions } from '@orkestrel/study/server'
 *
 * declare const root: string
 * declare const directory: string
 * const options: StudyInstallOptions = { root, directory, studies: ['assessment'] }
 * ```
 */
export interface StudyInstallOptions {
	readonly root: string
	readonly directory: string
	readonly studies: readonly string[]
	readonly profiles?: readonly string[]
	readonly provider?: Pick<StudyProvider, 'url' | 'digest'>
}

/**
 * Selects the study and profile to rehearse, an absent working directory, and an optional trial, goal range, or seed.
 * @example
 * ```ts
 * import type { StudyRehearsalOptions } from '@orkestrel/study/server'
 *
 * declare const directory: string
 * const options: StudyRehearsalOptions = {
 * 	study: 'assessment',
 * 	profile: 'local',
 * 	directory,
 * 	selection: { trial: 'r1-s1-a1' },
 * }
 * ```
 */
export interface StudyRehearsalOptions {
	readonly study: string
	readonly profile: string
	readonly directory: string
	readonly selection?: Pick<StudyExecutionRequest, 'trial' | 'goals' | 'seed'>
}

/**
 * Holds the frozen closure and each rehearsal step's outcome; a step after a failed one stays undefined.
 * @example
 * ```ts
 * import type { StudyRehearsal } from '@orkestrel/study/server'
 *
 * declare const rehearsal: StudyRehearsal
 * const sealed = rehearsal.result?.status === 'sealed'
 * const report = rehearsal.report?.stdout
 * ```
 */
export interface StudyRehearsal {
	readonly closure: StudyInstall | undefined
	readonly freeze: StudyInstallResult
	readonly check: StudyInstallResult | undefined
	readonly execute: StudyInstallResult | undefined
	readonly result: StudyResultView | undefined
	readonly grade: StudyInstallResult | undefined
	readonly report: StudyInstallResult | undefined
}
