import type {
	StudyInstallResult,
	StudyLaunchOptions,
	StudyRehearsal,
	StudyRehearsalOptions,
} from './types.js'
import { StudyError, isStudyDigest } from '@src/core'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readStudyClosure, resolveStudyPath } from '../commands/helpers.js'
import { matchesSystemError } from '../helpers.js'
import { readStudyResult } from '../stores/helpers.js'
import { STUDY_LAUNCH_CLEANUP, STUDY_LAUNCH_DURATION } from './constants.js'
import { buildStudySelectors, computeStudyExecutionDuration } from './helpers.js'
import { parseStudyCheck } from './parsers.js'
import { StudyLaunchChild } from './StudyLaunchChild.js'

/**
 * Runs an installed Study executable through its public command line, in its root and under a deadline.
 * @example Rehearse a study through its closure
 * ```ts
 * import { createStudyInstall } from '@orkestrel/study/server'
 *
 * declare const root: string
 * declare const directory: string
 * declare const workspace: string
 * const install = await createStudyInstall({ root, directory, studies: ['assessment'] })
 * const options = { study: 'assessment', profile: 'local', directory: workspace }
 * const rehearsal = await install.rehearse(options)
 * const sealed = rehearsal.result?.status === 'sealed'
 * ```
 */
export class StudyInstall {
	readonly #root: string
	readonly #entry: string

	/** Binds the install root each command runs in and the Study executable it runs.
	 * @param options - The install root and the executable entry.
	 */
	constructor(options: StudyLaunchOptions) {
		this.#root = options.root
		this.#entry = options.entry
	}

	/** Reports the install root each command runs in. */
	get root(): string {
		return this.#root
	}

	/** Reports the Study executable each command runs. */
	get entry(): string {
		return this.#entry
	}

	/** Runs the executable with only the given arguments and captures both streams under a deadline.
	 * @param arguments_ - The command tokens after the entry.
	 * @param duration - The deadline in milliseconds. Default: `STUDY_LAUNCH_DURATION + STUDY_LAUNCH_CLEANUP`.
	 * @returns The exit code, 124 after the deadline, each captured stream, and the elapsed milliseconds.
	 * @remarks The child inherits no runtime flags from this process. At the deadline the captured stderr ends with the deadline diagnostic. Detaching the child is platform-defined: a detached child gets its own process group on POSIX only, so the child is detached there alone; a Windows child stays attached and is terminated by its process tree.
	 */
	async execute(
		arguments_: readonly string[],
		duration = STUDY_LAUNCH_DURATION + STUDY_LAUNCH_CLEANUP,
	): Promise<StudyInstallResult> {
		const started = performance.now()
		const child = spawn(process.execPath, [this.#entry, ...arguments_], {
			cwd: this.#root,
			shell: false,
			windowsHide: true,
			detached: process.platform !== 'win32',
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		const result = await new StudyLaunchChild(
			child,
			duration,
			{ stdout: false, stderr: false },
			new AbortController().signal,
		).execute()
		return { ...result, duration: performance.now() - started }
	}

	/** Freezes a study, then checks, executes, reads, grades, and reports it through the frozen closure, skipping every step after a failed one.
	 * @param options - The study, profile, absent working directory, and optional selection.
	 * @returns The frozen closure and each step's outcome; a skipped step reads undefined.
	 * @throws StudyError - Thrown with code `CONFIG` when the directory exists or its parent is missing, and with code `FAULT` when check exits 0 without validated bounds or grade exits 0 without an assessment identity.
	 */
	async rehearse(options: StudyRehearsalOptions): Promise<StudyRehearsal> {
		const { study, profile, directory } = options
		const selectors = buildStudySelectors(options.selection ?? {})
		const destination = join(directory, 'closure')
		const output = join(directory, 'result')
		await mkdir(directory).catch((error: unknown) => {
			if (matchesSystemError(error, 'EEXIST'))
				throw new StudyError(
					'CONFIG',
					`Rehearsal directory exists: ${directory}; pass an absent directory on the install's volume`,
				)
			if (matchesSystemError(error, 'ENOENT'))
				throw new StudyError(
					'CONFIG',
					`Rehearsal directory parent is missing: ${dirname(directory)}; create it before rehearsing`,
				)
			throw error
		})
		const freeze = await this.execute(['freeze', study, '--profile', profile, '--to', destination])
		const closure = freeze.code === 0 ? new StudyInstall(readStudyClosure(destination)) : undefined
		const check =
			closure === undefined
				? undefined
				: await this.execute([
						'check',
						study,
						'--profile',
						profile,
						'--closure',
						destination,
						...selectors,
					])
		const checked = check?.code === 0 ? parseStudyCheck(parseJSON(check.stdout)) : undefined
		if (check?.code === 0 && checked === undefined)
			throw new StudyError('FAULT', 'Study check exited 0 without its validated bounds')
		const execute =
			checked === undefined
				? undefined
				: await this.execute(
						[
							'execute',
							study,
							'--profile',
							profile,
							'--closure',
							destination,
							'--out',
							output,
							...selectors,
						],
						computeStudyExecutionDuration(checked.bounds),
					)
		const result = execute?.code === 0 ? await readStudyResult(output) : undefined
		const grade =
			closure !== undefined && result?.status === 'sealed'
				? await closure.execute([
						'grade',
						output,
						'--rubric',
						resolveStudyPath(
							resolveStudyPath(join(closure.root, 'studies'), study),
							result.manifest.definition.rubric,
						),
					])
				: undefined
		const graded = grade?.code === 0 ? parseJSON(grade.stdout) : undefined
		const assessment =
			isRecord(graded) && isStudyDigest(graded.assessment) ? graded.assessment : undefined
		if (grade?.code === 0 && assessment === undefined)
			throw new StudyError('FAULT', 'Study grade exited 0 without its assessment identity')
		const report =
			closure !== undefined && assessment !== undefined
				? await closure.execute(['report', output, '--assessment', assessment])
				: undefined
		return { closure, freeze, check, execute, result, grade, report }
	}
}
