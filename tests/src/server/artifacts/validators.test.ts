import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ArtifactLoader } from '../../../../src/server/artifacts/ArtifactLoader.js'
import {
	isArtifactClosure,
	isArtifactKey,
	isArtifactLoaderOptions,
	isArtifactMember,
} from '../../../../src/server/artifacts/validators.js'
import {
	ARTIFACT_CLOSURE_FILES,
	ARTIFACT_REFUSED_KEYS,
	buildArtifactClosureOptions,
} from '../../../setupServer.js'

it('narrows closure shapes and refuses malformed and unreadable records without throwing', async () => {
	const scratch = createScratch({ files: ARTIFACT_CLOSURE_FILES })
	try {
		const options = buildArtifactClosureOptions(scratch)
		const closure = await new ArtifactLoader(options).materialize(join(scratch.path, 'copy'))
		expect(isArtifactLoaderOptions(options)).toBe(true)
		expect(isArtifactClosure(closure)).toBe(true)
		for (const member of closure.members) expect(isArtifactMember(member)).toBe(true)
		for (const key of ARTIFACT_REFUSED_KEYS) expect(isArtifactKey(key)).toBe(false)
		expect(isArtifactKey('caf\u00e9/e\u0301.txt')).toBe(true)
		for (const invalid of [
			undefined,
			null,
			[],
			1,
			{},
			{
				get destination() {
					throw new Error('unreadable')
				},
			},
		]) {
			expect(isArtifactClosure(invalid)).toBe(false)
			expect(isArtifactLoaderOptions(invalid)).toBe(false)
			expect(isArtifactMember(invalid)).toBe(false)
		}
		expect(isArtifactClosure({ ...closure, members: [] })).toBe(false)
		expect(isArtifactLoaderOptions({ ...options, source: {} })).toBe(false)
		expect(isArtifactLoaderOptions({ ...options, assets: [false] })).toBe(false)
		expect(
			isArtifactMember({ source: '', key: 'plain', digest: '0'.repeat(64), size: Number.NaN }),
		).toBe(false)
	} finally {
		await destroyScratch(scratch)
	}
})
