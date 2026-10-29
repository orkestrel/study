import * as setup from './setup.js'
import { describe, expect, it } from 'vitest'

// tests/setup.test.ts — proves `tests/setup.ts`, `setupFiles[0]` for every Vitest project. The
// module declares only the fixture interfaces the mirrored tests share, so it exports no value.

describe('setup', () => {
	it('exports only fixture types, so no runtime value', () => {
		expect(Object.keys(setup)).toEqual([])
	})
})
