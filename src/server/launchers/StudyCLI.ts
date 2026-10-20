import type { StudyLaunchOptions } from './types.js'
import { StudyError } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { StudyCommand } from '../commands/StudyCommand.js'
import { STUDY_COMMAND_HELP } from '../commands/constants.js'
import {
	STUDY_COMMAND_OPERATION,
	STUDY_TASK_OPERATION,
	STUDY_WORKER_OPERATION,
} from '../processes/constants.js'
import { StudyTaskWorker } from '../processes/StudyTaskWorker.js'
import { StudyWorker } from '../processes/StudyWorker.js'
import { StudyLauncher } from './StudyLauncher.js'

/** Dispatches private child routes before the public native supervisor. */
export class StudyCLI {
	#options: StudyLaunchOptions
	/** Owns the installed executable path and consumer working directory.
	 * @param options - Exact runtime entry and consumer root, snapshotted at construction.
	 */
	constructor(options: StudyLaunchOptions) {
		this.#options = { ...options }
	}
	/** Executes one route with truthful public exit semantics.
	 * @param arguments_ - Native command arguments.
	 * @returns The command, deadline, interruption, or invalid-input exit code.
	 */
	async execute(arguments_: readonly string[]): Promise<number> {
		try {
			if (
				[STUDY_COMMAND_OPERATION, STUDY_WORKER_OPERATION, STUDY_TASK_OPERATION].includes(
					arguments_[0] ?? '',
				) &&
				(process.send === undefined || !process.connected)
			)
				throw new StudyError(
					'CONFIG',
					`Private route ${JSON.stringify(arguments_[0])} requires supervised native IPC; use study check, execute, grade, label, or report. Use study --help for grammar.`,
				)
			if (arguments_[0] === STUDY_WORKER_OPERATION) {
				await new StudyWorker().execute()
				return 0
			}
			if (arguments_[0] === STUDY_TASK_OPERATION) {
				await new StudyTaskWorker().execute()
				return 0
			}
			if (arguments_[0] !== STUDY_COMMAND_OPERATION) {
				if (arguments_.includes('--help')) {
					process.stdout.write(STUDY_COMMAND_HELP)
					return 0
				}
				if (arguments_.length === 0) {
					process.stderr.write(STUDY_COMMAND_HELP)
					return 64
				}
				return await new StudyLauncher(this.#options).execute(arguments_)
			}
			const controller = new AbortController()
			const listener = controller.abort.bind(controller)
			process.once('SIGINT', listener)
			process.once('SIGTERM', listener)
			try {
				const result = await new StudyCommand(this.#options).execute(
					arguments_.slice(1),
					controller.signal,
				)
				process.stdout.write(`${JSON.stringify(result)}\n`)
				return controller.signal.aborted
					? 130
					: isRecord(result) && result.status === 'operational-failure'
						? 1
						: 0
			} finally {
				process.removeListener('SIGINT', listener)
				process.removeListener('SIGTERM', listener)
			}
		} catch (error) {
			const code =
				error instanceof Error && 'code' in error && typeof error.code === 'string'
					? error.code
					: 'FAULT'
			process.stderr.write(
				`study: ${code}: ${error instanceof Error ? error.message : String(error)}\n`,
			)
			return error instanceof StudyError
				? error.code === 'CONFIG'
					? 64
					: error.failure?.cause === 'deadline'
						? 124
						: error.failure?.cause === 'interrupted'
							? 130
							: 1
				: 1
		}
	}
}
