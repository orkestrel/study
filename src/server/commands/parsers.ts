import type { StudyCommandRequest } from './types.js'
import { isAbsolute, resolve } from 'node:path'
import { StudyError } from '../../core/errors.js'
import { isStudyDigest } from '../../core/validators.js'
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
		'Expected study check, execute, grade, label, or report; use study --help.'
	if (!['check', 'execute', 'grade', 'label', 'report'].includes(command ?? ''))
		throw new StudyError(
			'CONFIG',
			'Unknown or missing command ' + JSON.stringify(command ?? '<command>') + '. ' + usage,
		)
	if (target === undefined || target === '' || target.startsWith('-'))
		throw new StudyError(
			'CONFIG',
			'Missing <' +
				(command === 'check' || command === 'execute' ? 'study' : 'result') +
				'> before ' +
				JSON.stringify(target ?? '<end>') +
				'. ' +
				usage,
		)
	const allowed =
		command === 'check'
			? ['--profile']
			: command === 'execute'
				? ['--profile', '--out', '--expected']
				: command === 'grade'
					? ['--rubric']
					: command === 'label'
						? ['--grading', '--labels']
						: ['--grading']
	const tokens = arguments_.slice(2)
	const pairs = tokens.flatMap((flag, index) =>
		index % 2 === 0 ? [{ flag, value: tokens[index + 1] }] : [],
	)
	// Reversed so the earliest index of each flag is the one the lookup retains.
	const firsts = new Map(pairs.map(({ flag }, index) => [flag, index] as const).reverse())
	for (const [index, { flag, value }] of pairs.entries()) {
		if (!allowed.includes(flag))
			throw new StudyError(
				'CONFIG',
				JSON.stringify(flag) +
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
		pairs.flatMap(({ flag, value }) => (value === undefined ? [] : [[flag, value] as const])),
	)
	if (command === 'check' || command === 'execute') {
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
		return { command, target, profile, out, expected }
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
