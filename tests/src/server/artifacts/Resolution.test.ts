import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { Artifacts } from '../../../../src/server/artifacts/Artifacts.js'
import { readArtifact } from '../../../../src/server/artifacts/helpers.js'
import { Resolution } from '../../../../src/server/artifacts/Resolution.js'
import { createArtifactWorker } from '../../../setupServer.js'

it('loads supplied captured bytes and refuses disk drift before native loading', async () => {
	const scratch = createScratch()
	try {
		const path = scratch.write('index.js', 'export const value = 1\n')
		const captured = readArtifact(path)
		const resolution = new Resolution({
			token: 'proof',
			files: [{ ...captured, source: new TextEncoder().encode('export const value = 2\n') }],
		})
		const url = pathToFileURL(path)
		url.searchParams.set('artifact', 'proof')
		const result = resolution.load(
			url.href,
			{ format: 'module', conditions: [], importAttributes: {} },
			() => {
				throw new Error('Captured bytes must not reach native reading')
			},
		)
		expect(result.source).toEqual(new TextEncoder().encode('export const value = 2\n'))
		scratch.write(path, 'export const value = 3\n')
		expect(() =>
			resolution.load(url.href, { format: 'module', conditions: [], importAttributes: {} }, () => {
				throw new Error('Drift must refuse before continuation')
			}),
		).toThrow(/drifted/)
	} finally {
		await destroyScratch(scratch)
	}
})

it('admits loader builtins only from an explicitly recorded captured instrument package', async () => {
	const scratch = createScratch()
	try {
		const instrument = scratch.ensure('instrument')
		scratch.write(
			'instrument/package.json',
			JSON.stringify({ name: 'instrument', version: '1.0.0', type: 'module' }),
		)
		const entry = scratch.write(
			'instrument/dist/index.js',
			"import { registerHooks } from 'node:module'; import { spawn } from 'node:child_process'; export const value = typeof registerHooks + ':' + typeof spawn\n",
		)
		const sourceRoot = scratch.ensure('adapter')
		const sourceEntry = scratch.write(
			'adapter/index.mts',
			`export { value } from ${JSON.stringify(pathToFileURL(entry).href)}\n`,
		)
		const options = {
			entries: [entry],
			roots: [instrument],
			instrument,
			source: { root: sourceRoot, entry: sourceEntry },
		}
		expect(new Artifacts(options).inspect().instrument).toBe(instrument)
		expect(new Artifacts(options).inspect().digest).not.toBe(
			new Artifacts({
				entries: options.entries,
				roots: options.roots,
				source: options.source,
			}).inspect().digest,
		)
		expect(() => new Artifacts({ ...options, instrument: sourceRoot }).inspect()).toThrow(
			/admitted package root/,
		)
		const worker = createArtifactWorker(
			scratch,
			`const options = ${JSON.stringify(options)}; if (process.argv[2] === 'untrusted') delete options.instrument; const artifacts = new Artifacts(options); const namespace = await artifacts.load(options.source.entry); assert.equal(namespace.value, 'function:function'); console.log('instrument-loaded')`,
		)
		const trusted = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(trusted.status).toBe(0)
		expect(trusted.stdout).toContain('instrument-loaded')
		const untrusted = spawnSync(process.execPath, [worker, 'untrusted'], {
			encoding: 'utf8',
			timeout: 15000,
		})
		expect(untrusted.status).not.toBe(0)
		expect(untrusted.stderr).toContain('alternate loader is unsupported')
		scratch.write(sourceEntry, "export * from 'node:module'\n")
		const source = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(source.status).not.toBe(0)
		expect(source.stderr).toContain('alternate loader is unsupported')
		scratch.write('instrument/src/index.js', "export * from 'node:module'\n")
		scratch.write(
			sourceEntry,
			`export * from ${JSON.stringify(pathToFileURL(join(instrument, 'src/index.js')).href)}\n`,
		)
		const outside = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(outside.status).not.toBe(0)
		expect(outside.stderr).toContain('not admitted ESM')
	} finally {
		await destroyScratch(scratch)
	}
})
