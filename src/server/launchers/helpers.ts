import type { StudyAllowance, StudyProfile, StudyProviderDigest } from '@src/core'
import type { StudyExecutionSelector } from '../commands/types.js'
import { StudyError, parseStudyProfile } from '@src/core'
import { isAbsolute } from 'node:path'
import { STUDY_LAUNCH_CLEANUP, STUDY_LAUNCH_DURATION } from './constants.js'

/**
 * Renders a trial, goal range, and seed selection as the command's selector arguments.
 * @param selection - The selectors to render; an absent one renders nothing
 * @returns The `--trial`, `--goals`, and `--seed` arguments, in that order
 * @example Render selector arguments
 * ```ts
 * import { buildStudySelectors } from '@orkestrel/study/server'
 *
 * buildStudySelectors({ trial: 'r1-s1-a1', goals: { first: 'open', last: 'save' } })
 * // ['--trial', 'r1-s1-a1', '--goals', 'open..save']
 * ```
 */
export function buildStudySelectors(selection: StudyExecutionSelector): readonly string[] {
	const { trial, goals, seed } = selection
	return [
		...(trial === undefined ? [] : ['--trial', trial]),
		...(goals === undefined ? [] : ['--goals', goals.first + '..' + goals.last]),
		...(seed === undefined ? [] : ['--seed', seed.result + ':' + seed.trial + ':' + seed.goal]),
	]
}

/**
 * Rebinds a profile's provider to another URL and digests without its daemon, through the profile parser.
 * @param profile - A profile that declares a provider
 * @param url - The provider URL to bind
 * @param digests - The model pins to bind, paired with the provider's declared models
 * @returns The rebound profile, which the `parseStudyProfile` function admits unchanged
 * @throws StudyError - Thrown with code `CONFIG` when the profile declares no provider or the parser refuses the rebound profile
 * @example Rebind a profile to a fixture provider
 * ```ts
 * import type { StudyProfile } from '@orkestrel/study'
 * import { buildStudyFixtureProfile } from '@orkestrel/study/server'
 *
 * // A profile whose provider declares a daemon and no judge
 * declare const profile: StudyProfile
 * const rebound = buildStudyFixtureProfile(profile, 'http://127.0.0.1:11500', {
 * 	model: 'b'.repeat(64),
 * 	judge: undefined,
 * })
 * rebound.provider?.daemon // undefined
 * ```
 */
export function buildStudyFixtureProfile(
	profile: StudyProfile,
	url: string,
	digests: StudyProviderDigest,
): StudyProfile {
	if (profile.provider === undefined)
		throw new StudyError(
			'CONFIG',
			`Profile ${JSON.stringify(profile.name)} declares no provider to rebind; declare provider.entry, provider.url, provider.model, and provider.digest`,
		)
	const { daemon: _daemon, ...provider } = profile.provider
	return parseStudyProfile({ ...profile, provider: { ...provider, url, digest: digests } })
}

/**
 * Lists the key path of each absolute root and entry a profile declares.
 * @param profile - The profile as authored, before its paths resolve
 * @returns Each absolute `roots`, `agent`, `subject`, and `provider.entry` key path, in that order
 * @example Name absolute profile paths
 * ```ts
 * import type { StudyProfile } from '@orkestrel/study'
 * import { scanStudyAbsolutePaths } from '@orkestrel/study/server'
 *
 * // A profile whose agent, subject, and provider entries are relative paths
 * declare const profile: StudyProfile
 * scanStudyAbsolutePaths({ ...profile, roots: ['.', '/opt/vendor'] }) // ['roots[1]']
 * ```
 */
export function scanStudyAbsolutePaths(profile: StudyProfile): readonly string[] {
	return [
		...profile.roots.flatMap((path, index) => (isAbsolute(path) ? [`roots[${index}]`] : [])),
		...(isAbsolute(profile.agent) ? ['agent'] : []),
		...(isAbsolute(profile.subject) ? ['subject'] : []),
		...(profile.provider !== undefined && isAbsolute(profile.provider.entry)
			? ['provider.entry']
			: []),
	]
}

/**
 * Computes the deadline one supervised execution needs: the series duration plus the cleanup and check allowances.
 * @param bounds - The bounds a check reply validated
 * @returns The deadline in milliseconds
 * @example Compute the execute deadline
 * ```ts
 * import type { StudyAllowance } from '@orkestrel/study'
 * import { computeStudyExecutionDuration } from '@orkestrel/study/server'
 *
 * declare const bounds: StudyAllowance
 * computeStudyExecutionDuration({ ...bounds, series: { ...bounds.series, duration: 600000 } }) // 675000
 * ```
 */
export function computeStudyExecutionDuration(bounds: StudyAllowance): number {
	return bounds.series.duration + STUDY_LAUNCH_CLEANUP + STUDY_LAUNCH_DURATION
}
