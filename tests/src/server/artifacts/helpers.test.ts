import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { closeSync, openSync, opendirSync } from 'node:fs'
import { expect, it } from 'vitest'
import { ArtifactError, isArtifactError } from '../../../../src/server/artifacts/errors.js'
import {
	iterateArtifactEntries,
	readArtifact,
	readArtifactBytes,
} from '../../../../src/server/artifacts/helpers.js'

it('fills a buffer from the file position it continues at and returns only the bytes before an early end of file', async () => {
	const scratch = createScratch()
	try {
		const descriptor = openSync(scratch.write('bytes.bin', 'abcdef'), 'r')
		try {
			const whole = Buffer.alloc(6)
			expect(readArtifactBytes(descriptor, whole)).toBe(whole)
			expect(whole.toString()).toBe('abcdef')
			const resumed = Buffer.alloc(6)
			expect(readArtifactBytes(descriptor, resumed, 4)).toBe(resumed)
			expect(resumed.subarray(0, 4)).toEqual(Buffer.alloc(4))
			expect(resumed.subarray(4).toString()).toBe('ef')
			expect(readArtifactBytes(descriptor, Buffer.alloc(0)).length).toBe(0)
			const short = readArtifactBytes(descriptor, Buffer.alloc(8))
			expect(short.length).toBe(6)
			expect(short.toString()).toBe('abcdef')
		} finally {
			closeSync(descriptor)
		}
	} finally {
		await destroyScratch(scratch)
	}
})

it('iterates the remaining entries of a directory handle lazily and ends at the last entry', async () => {
	const scratch = createScratch()
	try {
		scratch.write('listing/a.ts', '')
		scratch.write('listing/b.ts', '')
		scratch.write('listing/c.ts', '')
		const handle = opendirSync(scratch.ensure('listing'))
		try {
			const entries = iterateArtifactEntries(handle)
			const first = entries.next()
			if (first.done === true) throw new Error('Missing first directory entry')
			const rest = [...entries]
			expect([first.value, ...rest].map((entry) => entry.name).sort()).toEqual([
				'a.ts',
				'b.ts',
				'c.ts',
			])
			expect(rest).toHaveLength(2)
			expect([...iterateArtifactEntries(handle)]).toEqual([])
		} finally {
			handle.closeSync()
		}
	} finally {
		await destroyScratch(scratch)
	}
})

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
