import type { StudyBounds, StudyProfile, StudyProvider } from '@src/core'
import type { StudyExecutionRequest } from '../commands/types.js'
import { StudyError, parseStudyProfile } from '@src/core'
import { isAbsolute } from 'node:path'
import { STUDY_LAUNCH_CLEANUP, STUDY_LAUNCH_DURATION } from './constants.js'

export function buildStudySelectors(
	selection: Pick<StudyExecutionRequest, 'trial' | 'goals' | 'seed'>,
): readonly string[] {
	const { trial, goals, seed } = selection
	return [
		...(trial === undefined ? [] : ['--trial', trial]),
		...(goals === undefined ? [] : ['--goals', goals.first + '..' + goals.last]),
		...(seed === undefined ? [] : ['--seed', seed.result + ':' + seed.trial + ':' + seed.goal]),
	]
}

export function buildStudyFixtureProfile(
	profile: StudyProfile,
	url: string,
	digests: StudyProvider['digest'],
): StudyProfile {
	if (profile.provider === undefined)
		throw new StudyError(
			'CONFIG',
			`Profile ${JSON.stringify(profile.name)} declares no provider to rebind; declare provider.entry, provider.url, provider.model, and provider.digest`,
		)
	const { daemon: _daemon, ...provider } = profile.provider
	return parseStudyProfile({ ...profile, provider: { ...provider, url, digest: digests } })
}

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

export function computeStudyExecutionDuration(bounds: StudyBounds): number {
	return bounds.series.duration + STUDY_LAUNCH_CLEANUP + STUDY_LAUNCH_DURATION
}
