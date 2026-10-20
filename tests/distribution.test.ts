// The artifact a consumer installs, measured rather than described. This workspace
// is packed and installed into a throwaway consumer, and every following claim is read
// off that installed tree: the exports map it publishes, the declarations it ships,
// and the module objects a real runtime hands a consumer. Nothing here names this
// package, one of its exports, or how many there are, so the proof stays true as
// the published surface moves.
import type { SpawnSyncReturns } from 'node:child_process'
import type { TestContext } from 'vitest'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// The compiler this workspace installs, run as a command rather than called in
// process: the command and its plain-text diagnostics are the same across the
// compiler majors this toolchain supports, and its in-process API is not. It is
// resolved from the workspace under proof, so a consumer of the packed artifact is
// checked by the same compiler that workspace's own `check` script runs.
const TSC = createRequire(join(ROOT, 'package.json')).resolve('typescript/bin/tsc')
// Windows needs a shell to launch a `.cmd`: Node refuses one directly since the
// batch-argument hardening, and `spawnSync` returns `EINVAL` with a null status
// rather than an exit code a caller can read. Every following argument is a literal or
// a path this file built, so the shell has nothing to escape.
const SHELL = process.platform === 'win32'
// `prepublishOnly` runs this proof as `npm run test:distribution -- --mode release`,
// and the root configuration's project factories carry that mode into this project.
// Release is the publish gate, so evidence it cannot obtain fails there and skips
// everywhere else: a gate that passes on missing evidence proves nothing.
const RELEASE = import.meta.env.MODE === 'release'
// The built output directory convention a browser face may publish from. Every
// selection reads this prefix off the export target and never off the subpath name. A
// workspace whose only published face is the browser one publishes that face at the
// root subpath, so a rule keyed on the subpath name drives a browser bundle through
// Node and the miss is silent.
const BROWSER_OUTPUT = './dist/src/browser/'
const ABSENT_SUBPATH = '/no-subpath-is-published-under-this-name'
// A compiler diagnostic that says where it is: the path relative to the directory
// the compiler ran in, the 1-based line and column, the code, and the message. The
// diagnostics are the verdict rather than the exit code, which differs between the
// compiler majors this toolchain supports, so a reported line matching nothing here
// came from something other than a check of a consumer module.
const DIAGNOSTIC_PATTERN = /^(.+?)\(\d+,\d+\): error TS\d+: /u
const PING = ['ping', '--fetch-retries=0', '--fetch-timeout=5000', '--loglevel=silent']
const ESM_DRIVER = 'drive.mjs'
const CJS_DRIVER = 'drive.cjs'
const CONSUMER_MANIFEST = `{ "name": "distribution-consumer", "version": "0.0.0-consumer", "private": true, "type": "module" }\n`
const ESM_DRIVER_SOURCE = `const entry = await import(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(entry).sort()))
`
const CJS_DRIVER_SOURCE = `const entry = require(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(entry).sort()))
`
// Drives the installed import and require copies against each other, so a Study error
// one module copy throws is read by the other copy's guard and attribution.
const ERROR_DRIVER = 'errors.mjs'
const ERROR_DRIVER_SOURCE = `import { createRequire } from 'node:module'
const imported = await import(process.argv[2])
const required = createRequire(import.meta.url)(process.argv[2])
const failure = { cause: 'capacity', message: 'Context full', role: 'agent' }
const lookalike = Object.assign(new Error('Foreign'), { name: 'StudyError', code: 'CAPACITY' })
process.stdout.write(JSON.stringify({
	distinct: imported.StudyError !== required.StudyError,
	imported: imported.isStudyError(new required.StudyError('CAPACITY', 'Required capacity')),
	required: required.isStudyError(new imported.StudyError('DEADLINE', 'Imported deadline')),
	capacity: imported.readStudyFailure(new required.StudyError('CAPACITY', 'Required capacity')),
	deadline: required.readStudyFailure(new imported.StudyError('DEADLINE', 'Imported deadline')),
	retained: imported.readStudyFailure(new required.StudyError('FAULT', 'Rejected', failure)) === failure,
	lookalike: imported.isStudyError(lookalike),
}))
`
const CORE_ESM_DRIVER = 'core.mjs'
const CORE_CJS_DRIVER = 'core.cjs'
const CORE_ESM_DRIVER_SOURCE = `import { StudyError } from '@orkestrel/study'
import { parseStudyArguments } from '@orkestrel/study/server'
try { parseStudyArguments([]) } catch (error) {
 process.stdout.write(JSON.stringify({ shared: error instanceof StudyError, code: error.code }))
}
`
const CORE_CJS_DRIVER_SOURCE = `const { StudyError } = require('@orkestrel/study')
const { parseStudyArguments } = require('@orkestrel/study/server')
try { parseStudyArguments([]) } catch (error) {
 process.stdout.write(JSON.stringify({ shared: error instanceof StudyError, code: error.code }))
}
`

// The extensions a JavaScript handler loads as modules. Node loads a native addon
// through its addon handler instead, so that extension is named separately.
const MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs']
const ADDON_EXTENSION = '.node'
// The extensions a declaration file carries. A `require` condition declares
// `.d.cts` and an ESM-only one `.d.mts`, so the `.d.ts` spelling alone does not
// name them.
const DECLARATION_EXTENSIONS = ['.d.ts', '.d.cts', '.d.mts']
type Format = 'module' | 'commonjs'

// The Node import target is resolved with the conditions that driver supplies. The
// CommonJS compile probe is selected from its declaration's format, and its runtime
// drive loads the same subpath through Node's require resolver. Vite's production
// client build enables its module and browser conditions.
const RUNTIME_CONDITIONS = Object.freeze({
	module: Object.freeze(['node-addons', 'node', 'import', 'module-sync']),
	commonjs: Object.freeze(['node-addons', 'node', 'require', 'module-sync']),
	browser: Object.freeze(['module', 'browser', 'production', 'import']),
})
// TypeScript's Node resolutions add `node` to the format condition. Its bundler
// resolution does not, so a browser drive compares against the declaration a bundler
// consumer reads rather than borrowing the Node declaration.
const BUNDLER_CONDITIONS = Object.freeze({
	module: ['types', 'import'],
	commonjs: ['types', 'require'],
})
const DECLARATION_CONDITIONS = Object.freeze({
	module: ['types', 'node', 'import'],
	commonjs: ['types', 'node', 'require'],
	browser: BUNDLER_CONDITIONS.module,
})

interface Resolution {
	readonly label: string
	readonly resolution: string
	readonly module: string
	readonly conditions: Readonly<Record<Format, readonly string[]>>
}

interface TargetResolution {
	readonly target: string
}

// Each compile driver carries the compiler options its scratch project sets and
// the conditions TypeScript applies for that resolution and importing format. A
// `require`-only subpath therefore stays in each CommonJS probe that can resolve it.
// The option values are the spellings the project file takes, so nothing here needs
// the compiler's own API to name them.
const RESOLUTIONS: readonly Resolution[] = [
	{
		label: 'node16',
		resolution: 'node16',
		module: 'node16',
		conditions: DECLARATION_CONDITIONS,
	},
	{
		label: 'nodenext',
		resolution: 'nodenext',
		module: 'nodenext',
		conditions: DECLARATION_CONDITIONS,
	},
	{
		label: 'bundler',
		resolution: 'bundler',
		module: 'esnext',
		conditions: BUNDLER_CONDITIONS,
	},
]

// The driver a bundled consumer reads declarations under. A browser application
// compiles through a bundler, so the browser drive answers under this one alone,
// and naming it here is what keeps that selection tied to the driver it selects.
const BROWSER_DRIVER = RESOLUTIONS.find((candidate) => candidate.label === 'bundler')
if (BROWSER_DRIVER === undefined) throw new Error("RESOLUTIONS carries no 'bundler' row")

const FORMATS: ReadonlyArray<readonly [extension: string, format: Format]> = [
	['ts', 'module'],
	['cts', 'commonjs'],
]

// One published subpath, resolved to what this proof can drive: the specifier a
// consumer writes, whether the declarations its consumer formats resolve at all,
// whether the exports map answers the browser condition with a target of its own,
// whether it answers `import` and `require` at all, and whether the target that
// `require` answers with is one that a CommonJS consumer loads.
interface Entry {
	readonly subpath: string
	readonly specifier: string
	readonly mapping: unknown
	readonly declaration: {
		readonly importable: boolean
		readonly requirable: boolean
		readonly browsable: boolean
	}
	readonly browsable: boolean
	readonly importable: boolean
	readonly requirable: boolean
	readonly loadable: boolean
}

// The installed tree every claim is read from. Every subpath the exports map names
// lands in exactly one of `entries`, `undeclared`, and `excluded`, so a subpath this
// proof cannot drive is reported rather than dropped.
interface Stage {
	readonly consumer: string
	readonly installed: string
	readonly archives: readonly string[]
	readonly entries: readonly Entry[]
	readonly subpaths: readonly string[]
	readonly undeclared: readonly string[]
	readonly excluded: readonly string[]
	readonly targets: readonly string[]
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNames(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((name) => typeof name === 'string')
}

// A fallback list, which is what Node reads an array in an exports entry as. The
// narrowing is what the following walkers need: `Array.isArray` widens an `unknown`
// member to `any`, and an entry read that way is not read at all.
function isList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value)
}

// Whether a string is a valid package target. Node rejects a target outside the
// package and a target containing a dot, parent, or node_modules segment during
// package-target resolution. A later module-resolution failure is not the same
// thing: an array falls through the former and keeps the latter.
function isPackageTarget(target: string): boolean {
	if (!target.startsWith('./')) return false
	for (const segment of target.slice(2).split(/[\\/]/u)) {
		const normalized = decodeSegment(segment).toLowerCase()
		if (normalized === '.' || normalized === '..' || normalized === 'node_modules') return false
	}
	return true
}

// A target segment percent-decoded the way Node reads it. A malformed escape leaves the
// segment as written, because Node validates the raw spelling in that case.
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment)
	} catch {
		return segment
	}
}

function readJson(path: string): unknown {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
	return parsed
}

function readManifestName(path: string): string {
	const manifest = readJson(path)
	if (!isRecord(manifest) || typeof manifest.name !== 'string') {
		throw new Error(`The manifest at ${path} declares no package name`)
	}
	return manifest.name
}

function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, content)
}

function readOutput(result: SpawnSyncReturns<string>): string {
	return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

function runNpm(args: readonly string[], cwd: string): SpawnSyncReturns<string> {
	return spawnSync(NPM, [...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, npm_config_cache: join(SCRATCH, 'cache') },
		shell: SHELL,
		windowsHide: true,
	})
}

function runNode(args: readonly string[], cwd: string): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [...args], { cwd, encoding: 'utf8', windowsHide: true })
}

// Node's own condition matching, read in declaration order.
function resolvePackageTarget(
	entry: unknown,
	conditions: readonly string[],
): TargetResolution | undefined {
	if (typeof entry === 'string') return { target: entry }
	if (isList(entry)) {
		for (const member of entry) {
			const resolved = resolvePackageTarget(member, conditions)
			if (resolved !== undefined && isPackageTarget(resolved.target)) return resolved
		}
		return undefined
	}
	if (!isRecord(entry)) return undefined
	for (const [condition, nested] of Object.entries(entry)) {
		if (condition !== 'default' && !conditions.includes(condition)) continue
		const resolved = resolvePackageTarget(nested, conditions)
		if (resolved !== undefined) return resolved
	}
	return undefined
}

// A flat entry, a condition-nested entry, and a fallback list all resolve through
// one walker. An entry may declare `types` beside `default` at its top level
// rather than inside `import`, so a fixed `entry.import.types` lookup is not
// equivalent to condition resolution.
function resolveTarget(entry: unknown, conditions: readonly string[]): string | undefined {
	return resolvePackageTarget(entry, conditions)?.target
}

// Whether a path is a physical file. TypeScript's file-existence check refuses a
// directory at the same spelling and continues to the outer package scope.
function matchesFile(path: string): boolean {
	try {
		return statSync(path).isFile()
	} catch {
		return false
	}
}

// TypeScript resolves a declaration target by accepting an existing declaration
// directly or by substituting beside a JavaScript target. A missing target leaves
// the containing condition or fallback list unresolved, so the walk continues.
function targetToDeclaration(target: string, installed: string): string | undefined {
	if (!isPackageTarget(target)) return undefined
	const declaration = target.endsWith('.cjs')
		? `${target.slice(0, -4)}.d.cts`
		: target.endsWith('.mjs')
			? `${target.slice(0, -4)}.d.mts`
			: target.endsWith('.js')
				? `${target.slice(0, -3)}.d.ts`
				: isDeclaration(target)
					? target
					: undefined
	if (declaration === undefined) return undefined
	return matchesFile(join(installed, declaration)) ? declaration : undefined
}

// The declaration TypeScript resolves through one importing format's conditions.
// Condition objects keep manifest order, and arrays keep fallback order.
function resolveDeclaration(
	entry: unknown,
	conditions: readonly string[],
	installed: string,
): string | undefined {
	if (typeof entry === 'string') return targetToDeclaration(entry, installed)
	if (isList(entry)) {
		for (const member of entry) {
			const resolved = resolveDeclaration(member, conditions, installed)
			if (resolved !== undefined) return resolved
		}
		return undefined
	}
	if (!isRecord(entry)) return undefined
	for (const [condition, nested] of Object.entries(entry)) {
		if (condition !== 'default' && !conditions.includes(condition)) continue
		const resolved = resolveDeclaration(nested, conditions, installed)
		if (resolved !== undefined) return resolved
	}
	return undefined
}

// The nearest package scope that decides a `.d.ts` declaration's module format. A
// physical nested manifest starts a scope even when it omits `type` or cannot be
// parsed. A directory at that spelling is not a manifest, so the walk continues.
function readPackageType(installed: string, directory: string): unknown {
	const path = join(directory, 'package.json')
	if (matchesFile(path)) {
		try {
			const manifest = readJson(path)
			return isRecord(manifest) ? manifest.type : undefined
		} catch {
			return undefined
		}
	}
	if (directory === installed) return undefined
	const parent = dirname(directory)
	if (parent === directory) return undefined
	return readPackageType(installed, parent)
}

function resolvesBrowser(entry: unknown): boolean {
	const module = resolveTarget(entry, RUNTIME_CONDITIONS.browser)
	if (module !== undefined && module.startsWith(BROWSER_OUTPUT)) return true
	if (module === undefined) return false
	const imported = resolveTarget(entry, RUNTIME_CONDITIONS.module)
	const required = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
	return module !== imported && module !== required
}

// Whether the target selected by Node's CommonJS conditions is a module require can
// load. A JavaScript target takes its own nearest package scope. Native addons and
// extensionless targets have their own CommonJS handlers.
function resolvesCommonJS(entry: unknown, installed: string): boolean {
	const target = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
	if (target === undefined) return false
	const name = target.slice(target.lastIndexOf('/') + 1)
	if (name.endsWith('.cjs')) return true
	if (name.endsWith('.mjs')) return false
	if (name.endsWith('.node')) return true
	if (!name.includes('.')) return true
	return (
		name.endsWith('.js') &&
		readPackageType(installed, dirname(join(installed, target))) !== 'module'
	)
}

// Whether the declaration selected by a typed CommonJS consumer admits that entry.
// A `.d.cts` declaration admits and a `.d.mts` declaration refuses. A `.d.ts`
// declaration takes its own nearest package scope.
function declaresCommonJS(entry: unknown, installed: string): boolean {
	const declaration = resolveDeclaration(entry, DECLARATION_CONDITIONS.commonjs, installed)
	if (declaration === undefined) return false
	if (declaration.endsWith('.d.cts')) return true
	if (declaration.endsWith('.d.mts')) return false
	return (
		declaration.endsWith('.d.ts') &&
		readPackageType(installed, dirname(join(installed, declaration))) !== 'module'
	)
}

// Every target an entry names under any condition. A fallback list omits members
// Node rejects during package-target validation, because no reader can take them.
function collectTargets(entry: unknown): readonly string[] {
	if (typeof entry === 'string') return [entry]
	if (isList(entry)) return entry.flatMap(collectTargets).filter(isPackageTarget)
	if (!isRecord(entry)) return []
	return Object.values(entry).flatMap((nested) => collectTargets(nested))
}

// Whether a target is a file a runtime loads for its names, which is what a
// declaration is owed for. The extension on the target's own file name decides it,
// and a name carrying no extension is code: `require` reads such a file through its
// JavaScript handler, so an extensionless target loads and publishes names. Node
// loads `.node` through its native-addon handler. Every other extension is an asset
// a consumer reads rather than imports — a stylesheet, a WebAssembly binary, the
// `"./package.json"` manifest pointer, and a declaration alike.
// The cost is an extensionless file published for a reader, such as a `LICENSE`:
// that target reports undeclared until it is given an extension or a declaration.
function isModule(target: string): boolean {
	const name = target.slice(target.lastIndexOf('/') + 1)
	const dot = name.lastIndexOf('.')
	if (name.endsWith(ADDON_EXTENSION)) return true
	return dot === -1 || MODULE_EXTENSIONS.includes(name.slice(dot))
}

// Whether a resolved target is a declaration rather than the JavaScript a
// `default` branch answers with when the entry declares no `types` condition.
function isDeclaration(target: string): boolean {
	return DECLARATION_EXTENSIONS.some((extension) => target.endsWith(extension))
}

// The declarations the Node module, Node CommonJS, and browser drives compare
// against. Each field uses the conditions of the TypeScript consumer paired with
// that runtime. A JavaScript target resolves through TypeScript's adjacent
// declaration substitution rather than standing in for the declaration itself.
function readDeclaration(
	entry: unknown,
	installed: string,
): {
	readonly module: string | undefined
	readonly commonjs: string | undefined
	readonly browser: string | undefined
} {
	return {
		module: resolveDeclaration(entry, DECLARATION_CONDITIONS.module, installed),
		commonjs: resolveDeclaration(entry, DECLARATION_CONDITIONS.commonjs, installed),
		browser: resolveDeclaration(entry, DECLARATION_CONDITIONS.browser, installed),
	}
}

// The entries one compile driver can resolve under its own conditions.
function selectEntries(entries: readonly Entry[], conditions: readonly string[]): readonly Entry[] {
	return entries.filter(
		(entry) =>
			resolveTarget(entry.mapping, conditions) !== undefined &&
			(!conditions.includes('require') || entry.loadable),
	)
}

// The compile drivers whose conditions reach one entry under one importing format.
// A driver that resolves no target for that entry compiles nothing, so a consumer
// written under it would report a resolution failure this package never made.
function selectDrivers(entry: Entry, format: Format): readonly Resolution[] {
	return RESOLUTIONS.filter(
		(driver) => selectEntries([entry], driver.conditions[format]).length > 0,
	)
}

// Requirable entries that declare CommonJS support but a typed CommonJS consumer
// cannot compile against. A default branch resolving under the require condition
// set makes no CommonJS claim.
function selectUntypable(entries: readonly Entry[], installed: string): readonly Entry[] {
	return entries.filter(
		(entry) =>
			entry.requirable &&
			isRecord(entry.mapping) &&
			Object.hasOwn(entry.mapping, 'require') &&
			!declaresCommonJS(entry.mapping, installed),
	)
}

// One surface comparison, written as the consumer module that proves it: the
// installed entry that consumer imports, the file extension fixing its importing
// format, the names a real runtime published off it, and the driver whose scratch
// project compiles it.
interface Surface {
	readonly entry: Entry
	readonly extension: string
	readonly published: readonly string[]
	readonly driver: Resolution
}

// A scratch project over named consumer modules, written beside them so their own
// resolution reaches the installed package. Nothing is emitted and no ambient types
// are pulled in, so what the check reads is the installed declarations alone.
function writeProject(
	stage: Stage,
	name: string,
	driver: Resolution,
	files: readonly string[],
): string {
	const path = join(stage.consumer, `tsconfig.${name}.json`)
	const project = {
		compilerOptions: {
			module: driver.module,
			moduleResolution: driver.resolution,
			noEmit: true,
			skipLibCheck: true,
			strict: true,
			target: 'esnext',
			types: [],
		},
		files: [...files],
	}
	writeFile(path, `${JSON.stringify(project, undefined, '\t')}\n`)
	return path
}

// The diagnostics the compiler this workspace installs reports for one scratch
// project. The compiler runs as a command, so nothing here reaches an API that
// moves between its majors, and the located lines it prints are the verdict rather
// than the exit code, which moves between them. A line carrying no location, a line
// naming the scratch project rather than a consumer module, and anything at all on
// the error stream are faults of this proof rather than of the package under proof,
// so each is raised where it happens instead of counted against the package.
function checkProject(stage: Stage, project: string): readonly string[] {
	const result = runNode([TSC, '--noEmit', '--pretty', 'false', '-p', project], stage.consumer)
	const refused = `${result.stderr ?? ''}`.trim()
	if (refused.length > 0) {
		throw new Error(`The consumer compiler wrote ${refused} to its error stream`)
	}
	const lines = `${result.stdout ?? ''}`.split(/\r\n|\n/u).filter((line) => line.trim().length > 0)
	// An elaborated diagnostic prints its detail on indented lines under its own
	// first line, so each of those joins the diagnostic it elaborates.
	const heads = lines.flatMap((line, index) =>
		index === 0 || !/^\s/u.test(line) ? [{ line, index }] : [],
	)
	for (const { line } of heads) {
		const located = DIAGNOSTIC_PATTERN.exec(line)?.[1]
		if (located === undefined) {
			throw new Error(`The consumer compiler reported ${line}, which names no location`)
		}
		if (resolve(stage.consumer, located) === project) {
			throw new Error(`The scratch project is itself at fault: ${line}`)
		}
	}
	const reported = heads.map(({ line, index }, position) =>
		[
			line,
			...lines.slice(index + 1, heads[position + 1]?.index).map((detail) => detail.trim()),
		].join(' '),
	)
	if (reported.length === 0 && result.status !== 0) {
		throw new Error(`The consumer compiler refused the project: ${readOutput(result)}`)
	}
	return reported
}

// One installed entry's published names checked against its own declarations by
// the compiler this workspace installs, in the direction each divergence surfaces
// under. The runtime's key list is written into the consumer as a literal, so the
// published side comes from a real process and the declared side from the
// declarations that process's package ships, and the two can disagree. A name the
// declarations carry and the runtime does not lands on `declared`. A name the
// runtime carries and the declarations do not, and a name the declarations publish
// as a type alone, land on `surfaced`: a variable widens into the type
// `declared` annotates, and only `surfaced` reads the literal's own keys back.
// Each names the member it is about, so the failure says which export moved.
function checkSurface(stage: Stage, surface: Surface): readonly string[] {
	const slug = surface.entry.subpath.replaceAll(/[^\w]+/gu, '-')
	const name = `surface.${surface.driver.label}${slug}.${surface.extension}`
	const module = `${name}`
	const keys = surface.published.map((key) => `${JSON.stringify(key)}: true`).join(', ')
	writeFile(
		join(stage.consumer, module),
		`import * as entry from ${JSON.stringify(surface.entry.specifier)}
const published = {${keys.length === 0 ? '' : ` ${keys} `}} as const
const declared: Record<keyof typeof entry, true> = published
const surfaced: Record<keyof typeof published, true> = declared
`,
	)
	const project = writeProject(stage, name, surface.driver, [`./${module}`])
	return checkProject(stage, project).map((line) => `${surface.driver.label}: ${line}`)
}

// One consumer module importing every installed entry, written where its own
// resolution finds the installed package.
function writeConsumerProbe(stage: Stage, path: string, specifiers: readonly string[]): void {
	const imports = specifiers.map((specifier, index) => ({
		binding: `entry${String(index)}`,
		specifier,
	}))
	const bindings = imports.map(
		({ binding, specifier }) => `import * as ${binding} from ${JSON.stringify(specifier)}`,
	)
	const names = imports.map(({ binding }) => binding)
	const source = `${bindings.join('\n')}\nexport const surface = [${names.join(', ')}]\n`
	writeFile(join(stage.consumer, path), source)
}

// The runtime key set a real process reads off one installed entry under one
// condition. The driver is a file rather than an `--eval` string, so the specifier
// travels as an argument and nothing needs escaping.
function driveRuntime(stage: Stage, specifier: string, driver: string): readonly string[] {
	const result = runNode([join(stage.consumer, driver), specifier], stage.consumer)
	if (result.status !== 0) {
		throw new Error(`Loading ${specifier} from the consumer failed: ${readOutput(result)}`)
	}
	const published: unknown = JSON.parse(result.stdout)
	if (!isNames(published)) throw new Error(`The driver printed no name list for ${specifier}`)
	return published
}

// Pack this workspace, install the archive into an isolated consumer, and read the
// published surface back off the installed tree. Every later claim reads this
// result, so a failure here is raised where it happens rather than once per entry.
function buildStage(): Stage {
	const packed = join(SCRATCH, 'packed')
	const consumer = join(SCRATCH, 'consumer')
	mkdirSync(packed, { recursive: true })
	const pack = runNpm(['pack', '--ignore-scripts', '--pack-destination', packed], ROOT)
	if (pack.status !== 0) throw new Error(`npm pack refused this workspace: ${readOutput(pack)}`)
	const archives = readdirSync(packed).filter((name) => name.endsWith('.tgz'))
	const archive = archives[0]
	if (archives.length !== 1 || archive === undefined) {
		throw new Error(`npm pack wrote no single archive: ${archives.join(', ')}`)
	}
	writeFile(join(consumer, 'package.json'), CONSUMER_MANIFEST)
	writeFile(join(consumer, ESM_DRIVER), ESM_DRIVER_SOURCE)
	writeFile(join(consumer, CJS_DRIVER), CJS_DRIVER_SOURCE)
	const install = runNpm(
		['install', '--ignore-scripts', '--no-audit', '--no-fund', join(packed, archive)],
		consumer,
	)
	if (install.status !== 0) {
		throw new Error(`Installing the packed archive failed: ${readOutput(install)}`)
	}
	const name = readManifestName(join(ROOT, 'package.json'))
	const installed = join(consumer, 'node_modules', ...name.split('/'))
	const manifest = readJson(join(installed, 'package.json'))
	if (!isRecord(manifest) || !isRecord(manifest.exports)) {
		throw new Error('The installed manifest publishes no exports map')
	}
	const mapped = Object.entries(manifest.exports).map(([subpath, entry]) => {
		const declaration = readDeclaration(entry, installed)
		return {
			subpath,
			entry,
			files: collectTargets(entry),
			declaration,
			declared:
				declaration.module !== undefined ||
				declaration.commonjs !== undefined ||
				declaration.browser !== undefined,
		}
	})
	// A subpath resolving no declaration is partitioned rather than dropped. It is a
	// defect when a runtime loads one of its targets for names, because a consumer
	// importing it compiles against nothing under `node16`. It is an excluded
	// publication otherwise: the `"./package.json"` manifest pointer and a stylesheet
	// are published for a reader rather than an importer.
	const entries = mapped
		.filter(({ declared }) => declared)
		.map(({ subpath, entry, declaration }) => {
			const importTarget = resolveTarget(entry, RUNTIME_CONDITIONS.module)
			const requireTarget = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
			const browserTarget = resolveTarget(entry, RUNTIME_CONDITIONS.browser)
			const browsable = resolvesBrowser(entry)
			const shadowed = browsable && requireTarget === browserTarget
			const requirable = requireTarget !== undefined && !shadowed
			const loadable = requirable && resolvesCommonJS(entry, installed)
			return {
				subpath,
				specifier: subpath === '.' ? name : `${name}${subpath.slice(1)}`,
				mapping: entry,
				declaration: {
					importable: declaration.module !== undefined,
					requirable: declaration.commonjs !== undefined,
					browsable: declaration.browser !== undefined,
				},
				browsable,
				importable: importTarget !== undefined && !(browsable && importTarget === browserTarget),
				requirable,
				loadable,
			}
		})
	const targets = mapped.flatMap(({ files }) => files)
	const subpaths = mapped.map(({ subpath }) => subpath)
	const undeclared = mapped
		.filter(({ declared, files }) => !declared && files.some(isModule))
		.map(({ subpath }) => subpath)
	const excluded = mapped
		.filter(({ declared, files }) => !declared && !files.some(isModule))
		.map(({ subpath }) => subpath)
	return { consumer, installed, archives, entries, subpaths, undeclared, excluded, targets }
}

// The scratch directory every claim allocates under. The path is fixed at collection and
// nothing is created until `beforeAll` runs, so a collection that fails leaves nothing behind.
const SCRATCH = join(tmpdir(), `distribution-${randomUUID()}`)
// Resolves with the staged consumer, or with `undefined` when the registry did not answer
// outside release. `beforeAll` settles it once, and every dependent test awaits it.
const staging = Promise.withResolvers<Stage | undefined>()

beforeAll(() => {
	mkdirSync(SCRATCH)
	mkdirSync(join(SCRATCH, 'cache'))
	staging.resolve(openStage())
})

afterAll(() => {
	rmSync(SCRATCH, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 })
})

// Installing the packed archive resolves its own runtime dependencies, so an
// unreachable registry leaves nothing to measure. Under release that is the gate
// failing; anywhere else the suite skips and names the mechanism it wanted.
function openStage(): Stage | undefined {
	try {
		if (runNpm(PING, ROOT).status !== 0) {
			if (!RELEASE) return undefined
			throw new Error(
				'The release gate requires a reachable npm registry, and npm ping did not answer',
			)
		}
		return buildStage()
	} catch (error) {
		rmSync(SCRATCH, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 })
		throw error
	}
}

describe('distribution classifiers', () => {
	it('classifies synthetic export mappings without a registry stage', () => {
		const root = join(SCRATCH, 'classifiers')
		writeFile(
			join(root, 'package.json'),
			JSON.stringify({
				type: 'commonjs',
				exports: {
					condition: { browser: './b.js', default: './n.js' },
					convention: { default: './dist/src/browser/index.js' },
					universal: { default: './shared.js' },
					'import-shared': {
						browser: './shared.mjs',
						import: './shared.mjs',
						default: './node.js',
					},
					'require-shared': {
						browser: './shared.cjs',
						require: './shared.cjs',
						default: './node.js',
					},
					node: { node: './node.js', default: './node.js' },
					silent: { 'module-sync': './x.cjs', import: './x.mjs' },
					module: { require: './x.mjs' },
					'nested-module': { require: './module/x.js' },
					'nested-commonjs': { require: './commonjs/x.js' },
					esm: { import: './x.mjs' },
				},
			}),
		)
		writeFile(join(root, 'module/package.json'), '{ "type": "module" }\n')
		writeFile(join(root, 'commonjs/package.json'), '{ "type": "commonjs" }\n')
		const manifest = readJson(join(root, 'package.json'))
		if (!isRecord(manifest) || !isRecord(manifest.exports)) {
			throw new Error('The classifier fixture declares no exports map')
		}
		const mappings = manifest.exports
		expect({
			condition: resolvesBrowser(mappings.condition),
			convention: resolvesBrowser(mappings.convention),
			universal: resolvesBrowser(mappings.universal),
			import: resolvesBrowser(mappings['import-shared']),
			require: resolvesBrowser(mappings['require-shared']),
			node: resolvesBrowser(mappings.node),
		}).toStrictEqual({
			condition: true,
			convention: true,
			universal: false,
			import: false,
			require: false,
			node: false,
		})
		expect({
			silent: resolvesCommonJS(mappings.silent, root),
			module: resolvesCommonJS(mappings.module, root),
			nestedModule: resolvesCommonJS(mappings['nested-module'], root),
			nestedCommonJS: resolvesCommonJS(mappings['nested-commonjs'], root),
			esm: resolvesCommonJS(mappings.esm, root),
		}).toStrictEqual({
			silent: true,
			module: false,
			nestedModule: false,
			nestedCommonJS: true,
			esm: false,
		})
	})
})

// The staged consumer, or a skip naming what the run could not reach. `it.skipIf`
// carries no reason, so the gate sits here where the test context can state one.
function requireStage(context: TestContext, staged: Stage | undefined): Stage {
	if (staged === undefined) {
		return context.skip('`npm ping` did not answer, so nothing was packed or installed')
	}
	return staged
}

describe('installed package consumer', () => {
	it('packs one archive and installs it in isolation [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		expect(stage.archives).toHaveLength(1)
		expect(existsSync(join(stage.installed, 'package.json'))).toBe(true)
		expect(stage.entries.length).toBeGreaterThan(0)
	})

	it("is a fixed point of npm's manifest fixer [requires the registry]", async (context) => {
		const stage = requireStage(context, await staging.promise)
		const manifest = readJson(join(stage.installed, 'package.json'))
		const directory = join(SCRATCH, 'manifest-fix')
		const path = join(directory, 'package.json')
		writeFile(path, `${JSON.stringify(manifest, undefined, '\t')}\n`)
		const result = runNpm(['pkg', 'fix'], directory)
		expect({ code: result.status, output: result.status === 0 ? '' : readOutput(result) }).toEqual({
			code: 0,
			output: '',
		})
		expect(readJson(path)).toStrictEqual(manifest)
	})

	it('runs the installed executable [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const manifest = readJson(join(stage.installed, 'package.json'))
		const consumer = readJson(join(stage.consumer, 'package.json'))
		if (!isRecord(manifest) || typeof manifest.version !== 'string') {
			throw new Error('The installed manifest declares no version')
		}
		if (!isRecord(consumer) || typeof consumer.version !== 'string') {
			throw new Error('The consumer manifest declares no version')
		}
		expect(consumer.version).not.toBe(manifest.version)
		const executable = join(
			stage.consumer,
			'node_modules',
			'.bin',
			process.platform === 'win32' ? 'study.cmd' : 'study',
		)
		// npm executes the installed shim through the consumer's command environment.
		const result = runNpm(
			['exec', '--offline', '--no', '--loglevel=silent', '--', executable, '--version'],
			stage.consumer,
		)
		expect({ code: result.status, output: result.status === 0 ? '' : readOutput(result) }).toEqual({
			code: 0,
			output: '',
		})
		expect(result.stdout).toBe(`${manifest.version}\n`)
		expect(result.stderr).toBe('')
	})

	it('ships every relative target its exports map names [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const relative = stage.targets.filter((target) => target.startsWith('./'))
		expect(relative).not.toStrictEqual([])
		expect(relative.filter((target) => !existsSync(join(stage.installed, target)))).toStrictEqual(
			[],
		)
	})

	// Every published subpath is driven, excluded by name, or reported here. A dropped
	// one leaves no trace: no runtime test, no declaration comparison, and no place in
	// the resolution compile, so the run reports success for a subpath it never
	// measured.
	it('declares types for every module it publishes [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const partitioned = [
			...stage.entries.map((entry) => entry.subpath),
			...stage.undeclared,
			...stage.excluded,
		]
		expect(stage.undeclared).toStrictEqual([])
		expect(partitioned.sort()).toStrictEqual([...stage.subpaths].sort())
		// A driven subpath answers a runtime condition. One resolving a declaration and
		// no Node or browser target compiles for a consumer and throws when that consumer
		// loads it. Each later drive retires itself for that entry, so this assertion names
		// the subpath rather than counting it as driven.
		const unreachable = stage.entries.filter(
			(entry) => !entry.importable && !entry.requirable && !entry.browsable,
		)
		expect(unreachable.map((entry) => entry.subpath)).toStrictEqual([])
		const untypable = selectUntypable(stage.entries, stage.installed)
		expect(untypable.map((entry) => entry.subpath)).toStrictEqual([])
	})

	it('refuses a subpath its exports map does not name [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const name = readManifestName(join(stage.installed, 'package.json'))
		const driver = join(stage.consumer, ESM_DRIVER)
		const result = runNode([driver, `${name}${ABSENT_SUBPATH}`], stage.consumer)
		expect(result.status).not.toBe(0)
		expect(readOutput(result)).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
	})

	// The absent subpath is the firing control: a resolution that reports nothing
	// for every published entry has not been shown to resolve anything at all. Each
	// module format carries its own control, because a format that resolves nothing
	// is silent for the same reason a resolution that resolves nothing is.
	it('compiles a consumer under every module resolution [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const name = readManifestName(join(stage.installed, 'package.json'))
		const results = RESOLUTIONS.flatMap((driver) =>
			FORMATS.flatMap(([extension, format]) => {
				const written = selectEntries(stage.entries, driver.conditions[format])
				if (written.length === 0) return []
				const label = `${driver.label}.${extension}`
				const probe = `probe.${label}`
				const specifiers = written.map((entry) => entry.specifier)
				writeConsumerProbe(stage, probe, specifiers)
				const meter = `meter.${label}`
				writeFile(
					join(stage.consumer, meter),
					`import { StudyControl } from '@orkestrel/study'
import type { StudyChannel, StudyRemoteMeterOptions } from '@orkestrel/study/server'
declare const channel: StudyChannel
export const options: StudyRemoteMeterOptions = { channel, control: new StudyControl() }
`,
				)
				const project = writeProject(stage, probe, driver, [`./${probe}`, `./${meter}`])
				const messages = checkProject(stage, project).map((message) => `${label}: ${message}`)
				const control = `control.${label}`
				writeConsumerProbe(stage, control, [`${name}${ABSENT_SUBPATH}`])
				const refused = writeProject(stage, control, driver, [`./${control}`])
				const invalid = `invalid-meter.${label}`
				writeFile(
					join(stage.consumer, invalid),
					`import type { StudyChannel, StudyRemoteMeterOptions } from '@orkestrel/study/server'
declare const channel: StudyChannel
export const options: StudyRemoteMeterOptions = { channel, control: new Map() }
`,
				)
				const rejected = writeProject(stage, invalid, driver, [`./${invalid}`])
				return [
					{
						label,
						messages,
						silent: checkProject(stage, refused).length === 0,
						nominal: checkProject(stage, rejected).length > 0,
					},
				]
			}),
		)
		expect(results.flatMap(({ messages }) => messages)).toStrictEqual([])
		expect(results.filter(({ silent }) => silent).map(({ label }) => label)).toStrictEqual([])
		expect(results.filter(({ nominal }) => !nominal).map(({ label }) => label)).toStrictEqual([])
	})

	// This proof drives a Node import and a Node require and carries no browser
	// branch: the workspace published no browser face when it was written, and the
	// browser drive measures the packed artifact, so only a published face is owed
	// one. A private browser application does not select this branch. It declares the
	// browser launcher and its Vitest browser provider and gets the generated browser
	// configuration module beside it, but installed browser tooling does not stand for
	// a published browser face. `vite` selects nothing either, though the branch
	// imports it: scaffold puts `vite` in every workspace's base development
	// dependencies, whatever that workspace publishes. The later Node
	// entry filters retire each matching Node drive for a face published
	// later, which leaves nothing measuring it. So it reddens here and names the
	// subpath a browser branch is owed for. A workspace that gains one deletes this
	// file and runs the `repair` verb, which writes the variant carrying that branch.
	it('publishes no browser face this proof cannot drive [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const faces = stage.entries.filter((entry) => entry.browsable)
		expect(faces.map((entry) => entry.subpath)).toStrictEqual([])
	})
})

describe('installed entries', () => {
	it('shares one core between the root and server entries [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		for (const [driver, source] of [
			[CORE_ESM_DRIVER, CORE_ESM_DRIVER_SOURCE],
			[CORE_CJS_DRIVER, CORE_CJS_DRIVER_SOURCE],
		] as const) {
			writeFile(join(stage.consumer, driver), source)
			const result = runNode([join(stage.consumer, driver)], stage.consumer)
			expect({
				code: result.status,
				output: result.status === 0 ? '' : readOutput(result),
			}).toEqual({ code: 0, output: '' })
			expect(JSON.parse(result.stdout)).toStrictEqual({ shared: true, code: 'CONFIG' })
		}
	})

	it('re-declares no core type in the server declarations [requires the registry]', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const [core, ...servers] = [
			'dist/src/core/index.d.ts',
			'dist/src/server/index.d.ts',
			'dist/src/server/index.d.cts',
		].map((path) => {
			const text = readFileSync(join(stage.installed, path), 'utf8')
			const names = [
				...text.matchAll(
					/^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|enum|function|interface|type|const)\s+([\w$]+)/gmu,
				),
			].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
			return { path, text, names }
		})
		if (core === undefined) throw new Error('Missing core declarations')
		expect(core.names).toContain('StudyControl')
		expect(core.names).toContain('StudyError')
		for (const server of servers) {
			expect(server.names.filter((name) => core.names.includes(name))).toEqual([])
			expect(
				/import\s+(?:type\s+)?\{[^}]*\bStudyControl\b[^}]*\}\s*from\s*['"]@orkestrel\/study['"]/u.test(
					server.text,
				),
			).toBe(true)
		}
	})

	it('publishes what it declares to a Node import, and no more', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const entries = stage.entries.filter((entry) => entry.importable)
		if (entries.length === 0) return context.skip('No installed entry supports Node import')
		for (const entry of entries) {
			if (!entry.declaration.importable) {
				throw new Error(`${entry.subpath} publishes no import declaration`)
			}
			const published = driveRuntime(stage, entry.specifier, ESM_DRIVER)
			const drivers = selectDrivers(entry, 'module')
			expect(drivers).not.toStrictEqual([])
			const reported = drivers.flatMap((driver) =>
				checkSurface(stage, { entry, extension: 'ts', published, driver }),
			)
			expect(reported).toStrictEqual([])
		}
	})

	it('publishes what it declares to a Node require, and no more', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const entries = stage.entries.filter((entry) => entry.requirable)
		if (entries.length === 0) return context.skip('No installed entry supports Node require')
		for (const entry of entries) {
			if (!entry.declaration.requirable) {
				throw new Error(`${entry.subpath} publishes no require declaration`)
			}
			const published = driveRuntime(stage, entry.specifier, CJS_DRIVER)
			const drivers = selectDrivers(entry, 'commonjs')
			expect(drivers).not.toStrictEqual([])
			const reported = drivers.flatMap((driver) =>
				checkSurface(stage, { entry, extension: 'cts', published, driver }),
			)
			expect(reported).toStrictEqual([])
		}
	})

	it('recognizes a study error across the installed import and require copies', async (context) => {
		const stage = requireStage(context, await staging.promise)
		const entry = stage.entries.find(
			(candidate) => candidate.subpath === '.' && candidate.importable && candidate.requirable,
		)
		if (entry === undefined) throw new Error('The root entry publishes no import and require pair')
		writeFile(join(stage.consumer, ERROR_DRIVER), ERROR_DRIVER_SOURCE)
		const result = runNode([join(stage.consumer, ERROR_DRIVER), entry.specifier], stage.consumer)
		if (result.status !== 0) throw new Error(`The error driver failed: ${readOutput(result)}`)
		expect(JSON.parse(result.stdout)).toStrictEqual({
			distinct: true,
			imported: true,
			required: true,
			capacity: { cause: 'capacity', message: 'Required capacity' },
			deadline: { cause: 'deadline', message: 'Imported deadline' },
			retained: true,
			lookalike: false,
		})
	})
})
