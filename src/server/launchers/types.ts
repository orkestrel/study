import type { StudyBounds, StudyProvider } from '@src/core'
import type { StudyExecutionRequest } from '../commands/types.js'
import type { StudyResultView } from '../stores/types.js'
import type { StudyInstall } from './StudyInstall.js'

/** Selects the native command entry and the caller's consumer root. */
export interface StudyLaunchOptions {
	readonly root: string
	readonly entry: string
}

/** Retains the bounded command exit and captured output. */
export interface StudyLaunchResult {
	readonly code: number
	readonly stdout: string
	readonly stderr: string
}

export interface StudyCheckReply {
	readonly bounds: StudyBounds
	readonly fingerprint: string | undefined
}

export interface StudyInstallResult extends StudyLaunchResult {
	readonly duration: number
}

export interface StudyInstallOptions {
	readonly root: string
	readonly directory: string
	readonly studies: readonly string[]
	readonly profiles?: readonly string[]
	readonly provider?: Pick<StudyProvider, 'url' | 'digest'>
}

export interface StudyRehearsalOptions {
	readonly study: string
	readonly profile: string
	readonly directory: string
	readonly selection?: Pick<StudyExecutionRequest, 'trial' | 'goals' | 'seed'>
}

export interface StudyRehearsal {
	readonly closure: StudyInstall | undefined
	readonly freeze: StudyInstallResult
	readonly check: StudyInstallResult | undefined
	readonly execute: StudyInstallResult | undefined
	readonly result: StudyResultView | undefined
	readonly grade: StudyInstallResult | undefined
	readonly report: StudyInstallResult | undefined
}
