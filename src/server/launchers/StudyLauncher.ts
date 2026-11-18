import type { StudyLaunchResult } from './types.js'
import type { StudyCommandOptions } from '../commands/types.js'
import { StudyError } from '@src/core'
import { spawn } from 'node:child_process'
import { STUDY_COMMAND_DURATION } from '../commands/constants.js'
import { parseStudyArguments } from '../commands/parsers.js'
import { STUDY_COMMAND_OPERATION } from '../processes/constants.js'
import { STUDY_LAUNCH_CLEANUP, STUDY_LAUNCH_DURATION } from './constants.js'
import { buildStudySelectors } from './helpers.js'
import { parseStudyCheck } from './parsers.js'
import { StudyLaunchChild } from './StudyLaunchChild.js'

/**
 * Supervises finite command trees and binds offline check to execution.
 * @example
 * ```ts
 * declare const entry: string
 * const launcher = new StudyLauncher({ root: process.cwd(), entry })
 * const code = await launcher.execute(['check', 'assessment', '--profile', 'local']) // 0 when valid
 * ```
 */
export class StudyLauncher {
	readonly #root: string
	readonly #entry: string
	readonly #interruption = new AbortController()
	readonly #signal: () => void

	/** Owns the trusted runtime entry and caller working directory.
	 * @param options - Native entry and consumer root.
	 */
	constructor(options: StudyCommandOptions) {
		this.#root = options.root
		this.#entry = options.entry
		this.#signal = this.#interruption.abort.bind(this.#interruption)
	}

	/** Checks and supervises the requested command under its finite native allowance.
	 * @param arguments_ - Public command tokens.
	 * @returns The exact operational or supervisor exit code.
	 * @remarks
	 * Detaching each command child is platform-defined: a detached child gets its own process group on
	 * POSIX only, so the child is detached there alone; a Windows child stays attached and is
	 * terminated by its process tree.
	 */
	async execute(arguments_: readonly string[]): Promise<number> {
		const entry = this.#entry
		const request = parseStudyArguments(arguments_)
		process.on('SIGINT', this.#signal)
		process.on('SIGTERM', this.#signal)
		try {
			if (request.command !== 'execute') {
				if (this.#interruption.signal.aborted) return 130
				return (await this.#launch(entry, arguments_, STUDY_LAUNCH_DURATION, true)).code
			}
			const selectors = buildStudySelectors(request)
			const check = [
				'check',
				request.target,
				'--profile',
				request.profile,
				...(request.closure === undefined ? [] : ['--closure', request.closure]),
				...(request.extend === undefined ? [] : ['--extend', request.extend]),
				...selectors,
			]
			const outcome = await this.#launch(entry, check, STUDY_LAUNCH_DURATION, false)
			if (outcome.code !== 0) {
				process.stdout.write(outcome.stdout)
				return outcome.code
			}
			const value = parseStudyCheck(JSON.parse(outcome.stdout))
			if (value === undefined || value.bounds.series.duration > STUDY_COMMAND_DURATION)
				throw new Error(
					'Study execution requires a validated series duration within the 24-hour host ceiling',
				)
			if (value.fingerprint === undefined)
				throw new Error('Study check did not return an execution fingerprint')
			const duration = value.bounds.series.duration + STUDY_LAUNCH_CLEANUP
			if (request.expected !== undefined && request.expected !== value.fingerprint)
				throw new StudyError('CONFIG', 'Validated execution differs from the requested fingerprint')
			const execution = [
				'execute',
				request.target,
				'--profile',
				request.profile,
				...(request.out === undefined ? [] : ['--out', request.out]),
				...(request.extend === undefined ? [] : ['--extend', request.extend]),
				...(request.closure === undefined ? [] : ['--closure', request.closure]),
				...(request.replay === undefined
					? []
					: [
							'--replay',
							request.replay.result,
							'--prefix',
							JSON.stringify(request.replay.prefix),
							'--offline',
							String(request.replay.offline),
						]),
				...(request.keyed === undefined
					? []
					: [
							'--replay',
							request.keyed.result,
							'--roles',
							JSON.stringify(request.keyed.roles),
							'--offline',
							String(request.keyed.offline),
						]),
				...selectors,
				'--expected',
				value.fingerprint,
			]
			if (this.#interruption.signal.aborted) return 130
			return (await this.#launch(entry, execution, duration, true)).code
		} finally {
			process.removeListener('SIGINT', this.#signal)
			process.removeListener('SIGTERM', this.#signal)
		}
	}

	// Spawns one command child; its own entity supervises the deadline, output allowance and interruption. Detaching is platform-defined: a detached child gets its own process group on POSIX only, and a Windows child is terminated by its process tree.
	#launch(
		entry: string,
		arguments_: readonly string[],
		duration: number,
		forward: boolean,
	): Promise<StudyLaunchResult> {
		const child = spawn(
			process.execPath,
			[...process.execArgv, entry, STUDY_COMMAND_OPERATION, ...arguments_],
			{
				cwd: this.#root,
				shell: false,
				windowsHide: true,
				detached: process.platform !== 'win32',
				stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
			},
		)
		return new StudyLaunchChild(
			child,
			duration,
			{ stdout: forward, stderr: true },
			this.#interruption.signal,
		).execute()
	}
}
