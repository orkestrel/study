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

export class StudyInstall {
	readonly #root: string
	readonly #entry: string

	constructor(options: StudyLaunchOptions) {
		this.#root = options.root
		this.#entry = options.entry
	}

	get root(): string {
		return this.#root
	}

	get entry(): string {
		return this.#entry
	}

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
