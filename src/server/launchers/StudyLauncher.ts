import type { StudyLaunchOptions, StudyLaunchResult } from './types.js'
import { isRecord } from '@orkestrel/contract'
import { spawn } from 'node:child_process'
import { StudyError } from '../../core/errors.js'
import { isStudyBounds, isStudyDigest } from '../../core/validators.js'
import { STUDY_COMMAND_DURATION } from '../commands/constants.js'
import { parseStudyArguments } from '../commands/parsers.js'
import { STUDY_COMMAND_OPERATION } from '../processes/constants.js'
import { STUDY_LAUNCH_CLEANUP, STUDY_LAUNCH_DURATION } from './constants.js'
import { StudyLaunchChild } from './StudyLaunchChild.js'

/** Supervises finite command trees and binds offline check to execution. */
export class StudyLauncher {
	readonly #root: string
	readonly #entry: string
	readonly #interruption = new AbortController()
	readonly #signal: () => void

	/** Owns the trusted runtime entry and caller working directory.
	 * @param options - Native entry and consumer root.
	 */
	constructor(options: StudyLaunchOptions) {
		this.#root = options.root
		this.#entry = options.entry
		this.#signal = this.#interruption.abort.bind(this.#interruption)
	}

	/** Checks and supervises the requested command under its finite native allowance.
	 * @param arguments_ - Public command tokens.
	 * @returns The exact operational or supervisor exit code.
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
			const check = ['check', request.target, '--profile', request.profile]
			const reading = await this.#launch(entry, check, STUDY_LAUNCH_DURATION, false)
			if (reading.code !== 0) {
				process.stdout.write(reading.output)
				return reading.code
			}
			const value: unknown = JSON.parse(reading.output)
			if (
				!isRecord(value) ||
				!isStudyBounds(value.bounds) ||
				value.bounds.series.duration > STUDY_COMMAND_DURATION
			)
				throw new Error(
					'Study execution requires a validated series duration within the 24-hour host ceiling',
				)
			if (!isStudyDigest(value.fingerprint))
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

	// Spawns one command child; its own entity supervises the deadline, output allowance and interruption.
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
		return new StudyLaunchChild(child, duration, forward, this.#interruption.signal).execute()
	}
}
