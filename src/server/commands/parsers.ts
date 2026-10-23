import type { StudyCommandRequest } from './types.js'
import { StudyError, isStudyDigest } from '@src/core'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { isAbsolute, resolve } from 'node:path'
import { isStudyCustodyName } from '../stores/validators.js'
import { STUDY_COMMAND_HELP } from './constants.js'
import { resolveStudyPath } from './helpers.js'

/** Parses public command tokens with operation-specific grammar diagnostics.
 * @param arguments_ - Exact command tokens, after the CLI help boundary.
 * @returns The independent operation request.
 * @throws StudyError when a token, required flag, or portable path is invalid.
 * @example Parse a study command
 * ```ts
 * import { parseStudyArguments } from '@orkestrel/study/server'
 *
 * parseStudyArguments(['check', 'files', '--profile', 'local'])
 * ```
 */
export function parseStudyArguments(arguments_: readonly string[]): StudyCommandRequest {
	const command = arguments_[0]
	const target = arguments_[1]
	const usage =
		STUDY_COMMAND_HELP.split('\n').find((line) => line.startsWith('study ' + command + ' ')) ??
		'Expected study check, freeze, execute, grade, label, or report; use study --help.'
	if (!['check', 'freeze', 'execute', 'grade', 'label', 'report'].includes(command ?? ''))
		throw new StudyError(
			'CONFIG',
			'Unknown or missing command ' + JSON.stringify(command ?? '<command>') + '. ' + usage,
		)
	if (target === undefined || target === '' || target.startsWith('-'))
		throw new StudyError(
			'CONFIG',
			'Missing <' +
				(command === 'check' || command === 'execute' || command === 'freeze'
					? 'study'
					: 'result') +
				'> before ' +
				JSON.stringify(target ?? '<end>') +
				'. ' +
				usage,
		)
	const allowed =
		command === 'check'
			? ['--profile', '--closure']
			: command === 'execute'
				? ['--profile', '--out', '--expected', '--closure', '--replay', '--prefix', '--offline']
				: command === 'freeze'
					? ['--profile', '--to']
					: command === 'grade'
						? ['--rubric']
						: command === 'label'
							? ['--grading', '--labels']
							: ['--grading']
	const tokens: ReadonlyArray<string | undefined> = arguments_.slice(2)
	// Positions, not present elements: a sparse token array keeps each hole as an absent flag or value.
	const pairs = [...tokens.entries()].flatMap(([index, flag]) =>
		index % 2 === 0 ? [{ flag, value: tokens[index + 1] }] : [],
	)
	// Reversed so the earliest index of each flag is the one the lookup retains.
	const firsts = new Map(pairs.map(({ flag }, index) => [flag, index] as const).reverse())
	for (const [index, { flag, value }] of pairs.entries()) {
		if (flag === undefined || !allowed.includes(flag))
			throw new StudyError(
				'CONFIG',
				JSON.stringify(flag ?? '<end>') +
					' is not a ' +
					command +
					' flag; accepts ' +
					allowed.join(', ') +
					'. ' +
					usage,
			)
		if (firsts.get(flag) !== index) throw new StudyError('CONFIG', flag + ' is duplicate. ' + usage)
		if (value === undefined || value === '' || value.startsWith('-'))
			throw new StudyError(
				'CONFIG',
				flag + ' requires a value before ' + JSON.stringify(value ?? '<end>') + '. ' + usage,
			)
	}
	const flags = new Map(
		pairs.flatMap(({ flag, value }) =>
			flag === undefined || value === undefined ? [] : [[flag, value] as const],
		),
	)
	if (command === 'check' || command === 'execute' || command === 'freeze') {
		if (!isStudyCustodyName(target))
			throw new StudyError(
				'CONFIG',
				'Invalid study token ' + JSON.stringify(target) + '; use a portable study name. ' + usage,
			)
		const profile = flags.get('--profile') ?? 'local'
		const out = flags.get('--out')
		const expected = flags.get('--expected')
		if (!isStudyCustodyName(profile))
			throw new StudyError(
				'CONFIG',
				'--profile ' + JSON.stringify(profile) + ' must be a portable name. ' + usage,
			)
		if (command === 'freeze') {
			if (!flags.has('--profile')) throw new StudyError('CONFIG', 'Missing --profile. ' + usage)
			const destination = flags.get('--to')
			if (destination === undefined) throw new StudyError('CONFIG', 'Missing --to. ' + usage)
			if (!isAbsolute(destination)) resolveStudyPath(resolve('.'), destination)
			return { command, target, profile, destination }
		}
		if (out !== undefined && !isAbsolute(out)) {
			try {
				resolveStudyPath(resolve('.'), out)
			} catch {
				throw new StudyError(
					'CONFIG',
					'--out ' +
						JSON.stringify(out) +
						' must be a portable contained path and cannot escape the consumer root. ' +
						usage,
				)
			}
		}
		if (expected !== undefined && !isStudyDigest(expected))
			throw new StudyError(
				'CONFIG',
				'--expected ' + JSON.stringify(expected) + ' must be a SHA-256 fingerprint. ' + usage,
			)
		const closure = flags.get('--closure')
		if (closure !== undefined && !isAbsolute(closure)) resolveStudyPath(resolve('.'), closure)
		const result = flags.get('--replay')
		const prefix = flags.get('--prefix')
		const offline = flags.get('--offline')
		if (result === undefined && (prefix !== undefined || offline !== undefined))
			throw new StudyError('CONFIG', '--prefix and --offline require --replay. ' + usage)
		const replay = result === undefined ? undefined : parseJSON(prefix ?? '')
		if (
			result !== undefined &&
			(!isRecord(replay) ||
				Object.keys(replay).length === 0 ||
				!Object.entries(replay).every(
					([trial, count]) =>
						isStudyCustodyName(trial) &&
						typeof count === 'number' &&
						Number.isSafeInteger(count) &&
						count > 0,
				) ||
				(offline !== 'true' && offline !== 'false'))
		)
			throw new StudyError(
				'CONFIG',
				'--replay requires --prefix trial counts and --offline true or false. ' + usage,
			)
		return {
			command,
			target,
			profile,
			out,
			expected,
			...(closure === undefined ? {} : { closure }),
			...(result === undefined || !isRecord(replay)
				? {}
				: {
						replay: {
							result,
							prefix: Object.fromEntries(
								Object.entries(replay).map(([trial, count]) => [trial, Number(count)]),
							),
							offline: offline === 'true',
						},
					}),
		}
	}
	if (command === 'grade') {
		const rubric = flags.get('--rubric')
		if (rubric === undefined) throw new StudyError('CONFIG', 'Missing --rubric. ' + usage)
		return { command, target, rubric }
	}
	const grading = flags.get('--grading')
	if (!isStudyDigest(grading))
		throw new StudyError(
			'CONFIG',
			'--grading ' +
				JSON.stringify(grading ?? '<missing>') +
				' must be an exact SHA-256 grading identity. ' +
				usage,
		)
	if (command === 'label') {
		const labels = flags.get('--labels')
		if (labels === undefined) throw new StudyError('CONFIG', 'Missing --labels. ' + usage)
		return { command, target, grading, labels }
	}
	return { command: 'report', target, grading }
}
