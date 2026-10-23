import { expect, it } from 'vitest'
import { isStudyClosure } from '../../../../src/server/commands/validators.js'

it('refuses malformed or unreadable closure publications without throwing', () => {
	expect(isStudyClosure(undefined)).toBe(false)
	expect(isStudyClosure({})).toBe(false)
	expect(
		isStudyClosure({
			get closure() {
				throw new Error('unreadable')
			},
		}),
	).toBe(false)
})
