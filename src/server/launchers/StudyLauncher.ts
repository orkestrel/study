import type { ChildProcess } from 'node:child_process'
import type { StudyLaunchOptions, StudyLaunchResult } from './types.js'
import { isRecord } from '@orkestrel/contract'
import { spawn } from 'node:child_process'
import { StudyError } from '../../core/errors.js'
import { isStudyBounds, isStudyDigest } from '../../core/validators.js'
import { STUDY_COMMAND_DURATION } from '../commands/constants.js'
import { parseStudyArguments } from '../commands/parsers.js'
import { STUDY_COMMAND_OPERATION } from '../processes/constants.js'
import { terminateStudyChild } from '../processes/helpers.js'
import { STUDY_LAUNCH_BYTES, STUDY_LAUNCH_CLEANUP, STUDY_LAUNCH_DURATION } from './constants.js'

/** Supervises finite command trees and binds offline check to execution. */
export class StudyLauncher {
	readonly #root: string
	readonly #entry: string
	readonly #signal: () => void
	#child: ChildProcess | undefined
	#interrupted = false

	/** Owns the trusted runtime entry and caller working directory.
	 * @param options - Native entry and consumer root.
	 */
	constructor(options: StudyLaunchOptions) {
		this.#root = options.root
		this.#entry = options.entry
		this.#signal = this.#interrupt.bind(this)
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
			let duration = STUDY_LAUNCH_DURATION
			let execution = arguments_
			if (request.command === 'execute') {
				const check = ['check', request.target, '--profile', request.profile]
				const reading = await this.#launch(entry, check, duration, false)
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
				duration = value.bounds.series.duration + STUDY_LAUNCH_CLEANUP
				if (request.expected !== undefined && request.expected !== value.fingerprint)
					throw new StudyError(
						'CONFIG',
						'Validated execution differs from the requested fingerprint',
					)
				execution = [
					'execute',
					request.target,
					'--profile',
					request.profile,
					...(request.out === undefined ? [] : ['--out', request.out]),
					'--expected',
					value.fingerprint,
				]
			}
			if (this.#interrupted) return 130
			return (await this.#launch(entry, execution, duration, true)).code
		} finally {
			process.removeListener('SIGINT', this.#signal)
			process.removeListener('SIGTERM', this.#signal)
		}
	}

	#launch(
		entry: string,
		arguments_: readonly string[],
		duration: number,
		forward: boolean,
	): Promise<StudyLaunchResult> {
		return new Promise((resolve, reject) => {
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
			this.#child = child
			const chunks: Buffer[] = []
			let bytes = 0
			let failure: Error | undefined
			let expired = false
			const timer = setTimeout(() => {
				expired = true
				terminateStudyChild(child)
			}, duration)
			child.stdout?.on('data', (chunk: Buffer) => {
				bytes += chunk.byteLength
				if (bytes > STUDY_LAUNCH_BYTES) {
					failure ??= new Error('Study command output exceeds the 16 MiB host allowance')
					terminateStudyChild(child)
					return
				}
				if (forward) process.stdout.write(chunk)
				else chunks.push(chunk)
			})
			child.stderr?.on('data', (chunk: Buffer) => {
				bytes += chunk.byteLength
				if (bytes > STUDY_LAUNCH_BYTES) {
					failure ??= new Error('Study command output exceeds the 16 MiB host allowance')
					terminateStudyChild(child)
					return
				}
				process.stderr.write(chunk)
			})
			child.once('error', (error) => {
				failure ??= error
			})
			child.once('close', (code) => {
				clearTimeout(timer)
				if (this.#child === child) this.#child = undefined
				if (failure !== undefined) {
					reject(failure)
					return
				}
				if (expired)
					process.stderr.write(
						`study: DEADLINE: Process tree exceeded its ${duration} ms deadline\n`,
					)
				resolve({
					code: this.#interrupted ? 130 : expired ? 124 : (code ?? 1),
					output: Buffer.concat(chunks).toString('utf8'),
				})
			})
			if (this.#interrupted) terminateStudyChild(child)
		})
	}

	#interrupt(): void {
		this.#interrupted = true
		if (this.#child !== undefined) terminateStudyChild(this.#child)
	}
}
