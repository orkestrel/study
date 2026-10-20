import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { StudyCLI } from '../../../../src/server/launchers/StudyCLI.js'

describe('StudyCLI', () => {
	it('returns version and help success before consumer access', async () => {
		const scratch = createScratch()
		try {
			scratch.write(
				'runtime/package.json',
				JSON.stringify({ name: '@orkestrel/study', version: '0.0.0-runtime' }),
			)
			const entry = scratch.write('runtime/dist/bin/main.js', 'export {}')
			const cli = new StudyCLI({ entry, root: scratch.ensure('consumer') })
			expect(await cli.execute(['--version'])).toBe(0)
			expect(await cli.execute(['--version', '--help'])).toBe(0)
			expect(scratch.names('consumer')).toEqual([])
		} finally {
			scratch.destroy()
		}
	})
	it('keeps its selected entry and root after the caller replaces the options', async () => {
		const scratch = createScratch()
		try {
			const options = {
				entry: scratch.write('original.mjs', 'process.exit(0)\n'),
				root: scratch.ensure('original-root'),
			}
			const cli = new StudyCLI(options)
			options.entry = scratch.write('replacement.mjs', 'process.exit(7)\n')
			options.root = scratch.ensure('replacement-root')
			expect(await cli.execute(['check', 'files', '--profile', 'test'])).toBe(0)
		} finally {
			scratch.destroy()
		}
	}, 20000)
})
