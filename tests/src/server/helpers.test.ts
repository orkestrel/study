import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	containsArtifact,
	decodeStudyJSON,
	encodeStudyJSON,
	hashStudyBytes,
} from '../../../src/server/helpers.js'

describe('server environment helpers', () => {
	it('identifies exact bytes and UTF-8 text with the same independent SHA-256 digest', () => {
		const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		expect(hashStudyBytes('abc')).toBe(abc)
		expect(hashStudyBytes(new TextEncoder().encode('abc'))).toBe(abc)
		expect(hashStudyBytes(new Uint8Array())).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		)
		expect(hashStudyBytes('é ✓')).toBe(hashStudyBytes(new TextEncoder().encode('é ✓')))
		expect(hashStudyBytes('changed evidence')).not.toBe(hashStudyBytes('retained evidence'))
	})

	it('encodes stable keys and omitted optional fields as one terminated canonical record', () => {
		expect(
			Buffer.from(encodeStudyJSON({ optional: undefined, nested: { z: 2, a: 1 } })).toString(),
		).toBe('{"nested":{"a":1,"z":2}}\n')
		expect(encodeStudyJSON({ b: 2, a: 1 })).toEqual(encodeStudyJSON({ a: 1, b: 2 }))
		expect(() => encodeStudyJSON(undefined)).toThrow('Record cannot be encoded')
	})

	it('decodes strict UTF-8 JSON, returns undefined for malformed JSON and refuses invalid bytes', () => {
		expect(decodeStudyJSON(encodeStudyJSON({ id: 1, label: 'é' }))).toEqual({
			label: 'é',
			id: 1,
		})
		expect(decodeStudyJSON(Buffer.from('{', 'utf8'))).toBeUndefined()
		expect(() => decodeStudyJSON(new Uint8Array([0x7b, 0xff, 0x7d]))).toThrow(TypeError)
	})

	it('checks strict lexical containment without admitting the root or an escape', () => {
		const scratch = createScratch()
		try {
			const path = scratch.write('entry.js', 'abc')
			expect(containsArtifact(scratch.path, path)).toBe(true)
			expect(containsArtifact(scratch.path, scratch.path)).toBe(false)
			expect(containsArtifact(scratch.path, join(scratch.path, '..', 'outside.js'))).toBe(false)
			expect(containsArtifact(scratch.path, join(`${scratch.path}-sibling`, 'entry.js'))).toBe(
				false,
			)
		} finally {
			scratch.destroy()
		}
	})
})
