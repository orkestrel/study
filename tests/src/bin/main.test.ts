import { describe, expect, it } from 'vitest'

describe('bin entry', () => {
	it('has no starter exports', async () => {
		const entry = await import('../../../src/bin/main.js')
		expect(Object.keys(entry)).toStrictEqual([])
	})
})
