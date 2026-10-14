import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { expect, it } from 'vitest'
import { ArtifactError, isArtifactError } from '../../../../src/server/artifacts/errors.js'
import { readArtifact } from '../../../../src/server/artifacts/helpers.js'

it('reads canonical bounded bytes and checks identities against an independent digest', async () => {
	const scratch = createScratch()
	try {
		const path = scratch.write('entry.js', 'abc')
		expect(readArtifact(path).digest).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		)
		expect(readArtifact(path).size).toBe(3)
		expect(Buffer.from(readArtifact(path).source).toString()).toBe('abc')
		expect(() => readArtifact(path, 2)).toThrow(/byte limit/)
		expect(() => readArtifact(path, Number.NaN)).toThrow(/byte budget/)
		expect(() => readArtifact('relative.js')).toThrow(/canonical regular file/)
		expect(() => readArtifact(scratch.path)).toThrow(/canonical regular file/)
		expect(isArtifactError(new ArtifactError('refusal'))).toBe(true)
		expect(isArtifactError(new Error('other'))).toBe(false)
	} finally {
		await destroyScratch(scratch)
	}
})
