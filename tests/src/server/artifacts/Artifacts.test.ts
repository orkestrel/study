import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { spawnSync } from 'node:child_process'
import { closeSync, ftruncateSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { Artifacts } from '../../../../src/server/artifacts/Artifacts.js'
import {
	ARTIFACT_BYTES,
	ARTIFACT_DEPTH,
	ARTIFACT_FILE_BYTES,
	ARTIFACT_FILES,
	ARTIFACT_ROOTS,
	ARTIFACT_VISITS,
} from '../../../../src/server/artifacts/constants.js'
import { createArtifactWorker } from '../../../setupServer.js'

it('captures separate built and source inventories and drives native confined execution in fresh workers', async () => {
	const scratch = createScratch()
	try {
		scratch.ensure('subject/dist')
		const subject = scratch.ensure('subject')
		const dependency = scratch.ensure('subject/node_modules/dependency')
		scratch.write(
			'subject/package.json',
			JSON.stringify({
				name: 'subject',
				version: '1.0.0',
				type: 'module',
				exports: './dist/index.js',
			}),
		)
		scratch.write(
			'subject/node_modules/dependency/package.json',
			JSON.stringify({
				name: 'dependency',
				version: '1.0.0',
				type: 'module',
				exports: { import: './dist/index.js', require: './dist/index.cjs' },
			}),
		)
		const part = scratch.write(
			'subject/node_modules/dependency/dist/index.js',
			'export const value = 7\n',
		)
		scratch.write(
			'subject/node_modules/dependency/dist/index.cjs',
			'module.exports = { value: 99 }\n',
		)
		scratch.write('subject/src/index.js', 'export const value = 100\n')
		scratch.write('subject/dist/data.json', '{"message":"ran"}\n')
		const marker = join(scratch.path, 'executed.txt')
		const entry = scratch.write(
			'subject/dist/index.js',
			`import { writeFileSync } from 'node:fs'; import { value } from 'dependency'; import data from './data.json' with { type: 'json' }; writeFileSync(${JSON.stringify(marker)}, data.message); export { value }; export const late = () => import('./late.js')\n`,
		)
		const late = scratch.write('subject/dist/late.js', 'export const value = 11\n')
		const sourceRoot = scratch.ensure('subject/studies/example')
		const sourcePart = scratch.write(
			'subject/studies/example/part.ts',
			'export const value: number = 5\n',
		)
		scratch.write('subject/studies/example/types.d.ts', 'export type Unused = string\n')
		const sourceEntry = scratch.write(
			'subject/studies/example/index.ts',
			"import type { Unused } from './types.js'; import { value } from './part.js'; import { value as built, late } from 'subject'; export const total: number = value + built; export { late }; export const asynchronous = await Promise.resolve(19)\n",
		)
		const options = {
			entries: [entry],
			roots: [subject, dependency],
			source: { root: sourceRoot, entry: sourceEntry },
		}
		const artifacts = new Artifacts(options)
		const inventory = artifacts.inspect()
		scratch.write('subject/studies/example/rubric.json', '{"hidden":"first"}\n')
		expect(new Artifacts(options).inspect().digest).toBe(inventory.digest)
		scratch.write('subject/studies/example/rubric.json', '{"hidden":"changed"}\n')
		expect(new Artifacts(options).inspect().digest).toBe(inventory.digest)
		expect(scratch.has(marker)).toBe(false)
		expect(inventory.node).toBe(process.version)
		expect(inventory.runtime.arguments).toEqual(process.execArgv)
		expect(inventory.source).toEqual(options.source)
		expect(Object.isFrozen(inventory.files)).toBe(true)
		expect(inventory.files.map((file) => file.path)).toContain(part)
		expect(inventory.files.map((file) => file.path)).toContain(sourcePart)
		expect(inventory.files.map((file) => file.path)).not.toContain(join(sourceRoot, 'types.d.ts'))
		expect(
			new Artifacts({ entries: [], roots: [], source: options.source }).inspect().packages,
		).toEqual([])
		expect(() => new Artifacts({ entries: [], roots: [] }).inspect()).toThrow(/empty/)
		expect(() => new Artifacts({ ...options, roots: ['relative'] }).inspect()).toThrow(
			/canonical package root/,
		)
		expect(() => new Artifacts({ ...options, roots: [subject, subject] }).inspect()).toThrow(
			/duplicated/,
		)
		expect(() =>
			new Artifacts({ ...options, entries: [join(subject, 'src/index.js')] }).inspect(),
		).toThrow(/built ESM/)
		expect(() =>
			new Artifacts({
				...options,
				source: { root: sourceRoot, entry: join(sourceRoot, 'missing.ts') },
			}).inspect(),
		).toThrow(/source entry/)
		expect(() =>
			new Artifacts({ ...options, source: { root: sourceRoot, entry } }).inspect(),
		).toThrow(/source entry/)
		expect(
			() => new Artifacts({ entries: [], roots: Array(ARTIFACT_ROOTS + 1).fill(subject) }),
		).toThrow(/limit/)
		expect(
			() => new Artifacts({ entries: Array(ARTIFACT_FILES + 1).fill(entry), roots: [subject] }),
		).toThrow(/limit/)
		const worker = createArtifactWorker(
			scratch,
			`
const options = ${JSON.stringify(options)}
const artifacts = new Artifacts(options)
artifacts.inspect()
if (process.argv[2] === 'drift') writeFileSync(${JSON.stringify(part)}, 'export const value = 8\\n')
if (process.argv[2] === 'source-drift') writeFileSync(${JSON.stringify(sourcePart)}, 'export const value: number = 6\\n')
const namespace: unknown = await artifacts.load(${JSON.stringify(sourceEntry)})
assert.ok(typeof namespace === 'object' && namespace !== null && 'total' in namespace && 'late' in namespace && typeof namespace.late === 'function')
assert.equal(namespace.total, process.argv[2] === 'changed' ? 13 : 12)
assert.ok('asynchronous' in namespace)
assert.equal(namespace.asynchronous, 19)
if (process.argv[2] === 'late-drift') writeFileSync(${JSON.stringify(late)}, 'export const value = 12\\n')
const later = await namespace.late()
assert.equal(later.value, 11)
if (process.argv[2] === 'verify') writeFileSync(${JSON.stringify(part)}, 'export const value = 8\\n')
if (process.argv[2] === 'fresh') await new Artifacts(options).load(${JSON.stringify(entry)})
artifacts.verify()
console.log('native-loaded:' + namespace.total + ':19:11')
`,
		)
		const loaded = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect({ status: loaded.status, stderr: loaded.status === 0 ? '' : loaded.stderr }).toEqual({
			status: 0,
			stderr: '',
		})
		expect(loaded.stdout).toContain('native-loaded:12:19:11')
		expect(scratch.read(marker)).toBe('ran')
		const builtOriginal = scratch.read(entry)
		if (builtOriginal === undefined) throw new Error('Missing built fixture')
		scratch.write(entry, "export { value } from '../src/index.js'\n")
		const builtEscape = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(builtEscape.status).not.toBe(0)
		expect(builtEscape.stderr).toContain('not admitted ESM')
		scratch.write(entry, "export { value } from '../node_modules/dependency/dist/index.cjs'\n")
		const commonjs = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(commonjs.status).not.toBe(0)
		expect(commonjs.stderr).toContain('not admitted ESM')
		scratch.write(entry, builtOriginal)
		scratch.write(part, 'export const value = 8\n')
		const changedBuilt = spawnSync(process.execPath, [worker, 'changed'], {
			encoding: 'utf8',
			timeout: 15000,
		})
		expect(changedBuilt.status).toBe(0)
		expect(changedBuilt.stdout).toContain('native-loaded:13:19:11')
		scratch.write(part, 'export const value = 7\n')
		const reused = spawnSync(process.execPath, [worker, 'fresh'], {
			encoding: 'utf8',
			timeout: 15000,
		})
		expect(reused.status).not.toBe(0)
		expect(reused.stderr).toContain('fresh process')
		const drift = spawnSync(process.execPath, [worker, 'drift'], {
			encoding: 'utf8',
			timeout: 15000,
		})
		expect(drift.status).not.toBe(0)
		expect(drift.stderr).toContain('drifted')
		scratch.write(part, 'export const value = 7\n')
		const sourceDrift = spawnSync(process.execPath, [worker, 'source-drift'], {
			encoding: 'utf8',
			timeout: 15000,
		})
		expect(sourceDrift.status).not.toBe(0)
		expect(sourceDrift.stderr).toContain('drifted')
		scratch.write(sourcePart, 'export const value: number = 5\n')
		const lateDrift = spawnSync(process.execPath, [worker, 'late-drift'], {
			encoding: 'utf8',
			timeout: 15000,
		})
		expect(lateDrift.status).not.toBe(0)
		expect(lateDrift.stderr).toContain('drifted')
		scratch.write(late, 'export const value = 11\n')
		const verify = spawnSync(process.execPath, [worker, 'verify'], {
			encoding: 'utf8',
			timeout: 15000,
		})
		expect(verify.status).not.toBe(0)
		expect(verify.stderr).toContain('drifted')
		scratch.write(part, 'export const value = 7\n')
		const original = scratch.read(sourceEntry)
		expect(original).toBeDefined()
		if (original === undefined) throw new Error('Missing source fixture')
		scratch.write(
			sourceEntry,
			"import rubric from './rubric.json' with { type: 'json' }; export const total = rubric.hidden\n",
		)
		const sourceJSON = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(sourceJSON.status).not.toBe(0)
		expect(sourceJSON.stderr).toContain('not admitted')
		scratch.write(sourceEntry, "throw new Error('source-top-level-failure')\n")
		const throwing = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(throwing.status).not.toBe(0)
		expect(throwing.stderr).toContain('source-top-level-failure')
		scratch.write(sourceEntry, 'export enum Unsupported { Value }\n')
		expect(() => new Artifacts(options).inspect()).toThrow(/not supported/)
		scratch.write(sourceEntry, "export { value } from '../outside.js'\n")
		scratch.write('subject/studies/outside.ts', 'export const value = 42\n')
		const escape = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(escape.status).not.toBe(0)
		expect(escape.stderr).toContain('escapes its root')
		scratch.write(sourceEntry, "export { value } from './missing.js'\n")
		const missing = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(missing.status).not.toBe(0)
		expect(missing.stderr).toContain('not admitted')
		scratch.write(
			sourceEntry,
			"export { value } from 'data:text/javascript,export const value=42'\n",
		)
		const data = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(data.status).not.toBe(0)
		expect(data.stderr).toContain('URL is unsupported')
		scratch.write(sourceEntry, "export * from 'node:module'\n")
		const builtin = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect(builtin.status).not.toBe(0)
		expect(builtin.stderr).toContain('alternate loader is unsupported')
		scratch.write(sourceEntry, original)
		scratch.write('subject/studies/example/part.js', 'export const value = 99\n')
		expect(() => new Artifacts(options).inspect()).toThrow(/ambiguous/)
		scratch.remove('subject/studies/example/part.js')
		scratch.link('subject/studies/example/linked', scratch.ensure('outside'))
		expect(() => new Artifacts(options).inspect()).toThrow(/links are unsupported/)
		scratch.remove('subject/studies/example/linked')
		scratch.write(sourcePart, 'export const value: number = 6\n')
		expect(new Artifacts(options).inspect().digest).not.toBe(inventory.digest)
		expect(() => artifacts.verify()).toThrow(/drifted/)
		const changedSource = spawnSync(process.execPath, [worker, 'changed'], {
			encoding: 'utf8',
			timeout: 15000,
		})
		expect(changedSource.status).toBe(0)
		expect(changedSource.stdout).toContain('native-loaded:13:19:11')
		scratch.write(sourcePart, 'export const value: number = 5\n')
		scratch.write('subject/studies/example/added.ts', 'export const added = true\n')
		expect(() => artifacts.verify()).toThrow(/drifted/)
		scratch.remove('subject/studies/example/added.ts')
		scratch.write('subject/dist/added.js', 'export const added = true\n')
		expect(() => artifacts.verify()).toThrow(/drifted/)
		scratch.remove('subject/dist/added.js')
		artifacts.verify()
		const oversized = scratch.write('subject/studies/example/oversized.ts', '')
		const descriptor = openSync(oversized, 'w')
		try {
			ftruncateSync(descriptor, ARTIFACT_FILE_BYTES + 1)
		} finally {
			closeSync(descriptor)
		}
		expect(() => new Artifacts(options).inspect()).toThrow(/byte limit/)
		scratch.remove(oversized)
		const sourceOnly = createArtifactWorker(
			scratch,
			`const options = ${JSON.stringify({ entries: [], roots: [], source: { root: sourceRoot, entry: sourcePart } })}; const artifacts = new Artifacts(options); const namespace = await artifacts.load(options.source.entry); assert.equal(namespace.value, 5); console.log('source-only-loaded')`,
		)
		const isolated = spawnSync(process.execPath, [sourceOnly], { encoding: 'utf8', timeout: 15000 })
		expect(isolated.status).toBe(0)
		expect(isolated.stdout).toContain('source-only-loaded')
	} finally {
		await destroyScratch(scratch)
	}
}, 60000)

it('refuses excluded built entries at direct and transitive edges while shared admitted modules load', async () => {
	const scratch = createScratch()
	try {
		const subject = scratch.ensure('subject')
		scratch.write(
			'subject/package.json',
			JSON.stringify({
				name: 'subject',
				version: '1.0.0',
				type: 'module',
				exports: './dist/index.js',
			}),
		)
		const marker = join(scratch.path, 'evaluated.txt')
		const entry = scratch.write(
			'subject/dist/index.js',
			`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'subject'); export const value = 1\n`,
		)
		const shared = scratch.write('subject/dist/shared.js', 'export const shared = 3\n')
		const sourceRoot = scratch.ensure('subject/studies/adapter')
		scratch.write('subject/studies/adapter/part.ts', "export { value } from 'subject'\n")
		const sourceEntry = scratch.write(
			'subject/studies/adapter/index.ts',
			`export { shared } from ${JSON.stringify(pathToFileURL(shared).href)}\nexport const value = 0\n`,
		)
		const options = {
			entries: [],
			roots: [subject],
			source: { root: sourceRoot, entry: sourceEntry },
		}
		expect(new Artifacts({ ...options, excluded: [entry] }).inspect().digest).toBe(
			new Artifacts(options).inspect().digest,
		)
		const load = `.load(${JSON.stringify(sourceEntry)})\nconsole.log('excluded-loaded:' + namespace.value)\n`
		const worker = createArtifactWorker(
			scratch,
			`const namespace = await new Artifacts(${JSON.stringify({ ...options, excluded: [entry] })})${load}`,
		)
		const allowed = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect({ status: allowed.status, stderr: allowed.status === 0 ? '' : allowed.stderr }).toEqual({
			status: 0,
			stderr: '',
		})
		expect(allowed.stdout).toContain('excluded-loaded:0')
		for (const source of [
			"export { value } from 'subject'\n",
			"export { value } from './part.js'\n",
		]) {
			scratch.write('subject/studies/adapter/index.ts', source)
			const refused = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
			expect(refused.status).not.toBe(0)
			expect(refused.stderr).toContain(`Artifact module is excluded: ${entry}`)
			expect(scratch.has(marker)).toBe(false)
		}
		createArtifactWorker(
			scratch,
			`const namespace = await new Artifacts(${JSON.stringify(options)})${load}`,
		)
		const control = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 15000 })
		expect({ status: control.status, stderr: control.status === 0 ? '' : control.stderr }).toEqual({
			status: 0,
			stderr: '',
		})
		expect(control.stdout).toContain('excluded-loaded:1')
		expect(scratch.read(marker)).toBe('subject')
	} finally {
		await destroyScratch(scratch)
	}
}, 30000)

it('refuses file counts, aggregate bytes, traversal populations and depth at finite capture limits', async () => {
	const scratch = createScratch()
	try {
		const source = scratch.ensure('files')
		for (let index = 0; index <= ARTIFACT_FILES; index++)
			scratch.write(join(source, `${index}.ts`), '')
		expect(() =>
			new Artifacts({
				entries: [],
				roots: [],
				source: { root: source, entry: join(source, '0.ts') },
			}).inspect(),
		).toThrow('file count limit')
		const bytes = scratch.ensure('bytes')
		for (let index = 0; index <= ARTIFACT_BYTES / ARTIFACT_FILE_BYTES; index++) {
			const descriptor = openSync(join(bytes, `${index}.ts`), 'w')
			try {
				ftruncateSync(descriptor, ARTIFACT_FILE_BYTES)
			} finally {
				closeSync(descriptor)
			}
		}
		expect(() =>
			new Artifacts({
				entries: [],
				roots: [],
				source: { root: bytes, entry: join(bytes, '0.ts') },
			}).inspect(),
		).toThrow('byte limit')
		const visits = scratch.ensure('visits')
		scratch.write(
			'visits/package.json',
			JSON.stringify({ name: 'visits', version: '1.0.0', type: 'module' }),
		)
		for (let index = 0; index <= Math.ceil(ARTIFACT_VISITS / ARTIFACT_ROOTS); index++)
			scratch.write(`visits/dist/${index}.txt`, '')
		expect(() =>
			new Artifacts({
				entries: [join(visits, 'dist/0.js')],
				roots: Array(ARTIFACT_ROOTS).fill(visits),
			}).inspect(),
		).toThrow('traversal limit')
		const depth = scratch.ensure('depth')
		let directory = depth
		for (let index = 0; index <= ARTIFACT_DEPTH; index++)
			directory = scratch.ensure(join(directory, 'd'))
		const entry = scratch.write(join(directory, 'index.ts'), '')
		expect(() =>
			new Artifacts({ entries: [], roots: [], source: { root: depth, entry } }).inspect(),
		).toThrow('depth limit')
	} finally {
		await destroyScratch(scratch)
	}
}, 30000)
