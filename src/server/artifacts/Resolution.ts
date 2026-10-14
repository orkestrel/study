import type {
	LoadHookContext,
	LoadFnOutput,
	ResolveHookContext,
	ResolveFnOutput,
} from 'node:module'
import type {
	ArtifactHookInput,
	ArtifactLoadHandler,
	ArtifactResolveHandler,
	ArtifactSource,
} from './types.js'
import { isBuiltin, stripTypeScriptTypes } from 'node:module'
import { basename, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ArtifactError } from './errors.js'
import { containsArtifact, readArtifact } from './helpers.js'

/** Enforces captured inventory membership at every synchronous native import edge. */
export class Resolution {
	#input: ArtifactHookInput
	#files: ReadonlyMap<string, ArtifactSource>

	/** Retains the trusted captured inventory and its private namespace.
	 * @param input - Captured built bytes and separate source selection.
	 */
	constructor(input: ArtifactHookInput) {
		this.#input = input
		this.#files = new Map(input.files.map((file) => [file.path, file]))
	}

	/** Resolves native edges with source-local JavaScript-to-TypeScript substitution.
	 * @param specifier - The requested native specifier.
	 * @param context - Node's resolution context.
	 * @param next - The remaining native resolution chain.
	 * @returns An admitted URL in the captured namespace.
	 */
	resolve(
		specifier: string,
		context: ResolveHookContext,
		next: ArtifactResolveHandler,
	): ResolveFnOutput {
		const parent = context.parentURL === undefined ? undefined : new URL(context.parentURL)
		const initial = specifier.startsWith('file:') ? new URL(specifier) : undefined
		if (
			parent?.searchParams.get('artifact') !== this.#input.token &&
			initial?.searchParams.get('artifact') !== this.#input.token
		)
			return next(specifier, context)
		if (isBuiltin(specifier)) {
			const instrument = this.#input.instrument
			const trusted =
				instrument !== undefined &&
				parent?.protocol === 'file:' &&
				containsArtifact(join(instrument, 'dist'), fileURLToPath(parent)) &&
				this.#files.has(fileURLToPath(parent))
			if (
				!trusted &&
				['module', 'vm', 'worker_threads', 'child_process', 'cluster'].includes(
					specifier.replace(/^node:/, ''),
				)
			)
				throw new ArtifactError(`Artifact alternate loader is unsupported: ${specifier}`)
			return next(specifier, context)
		}
		for (const file of this.#input.files) {
			if (basename(file.path) === 'package.json' && readArtifact(file.path).digest !== file.digest)
				throw new ArtifactError(`Artifact manifest drifted: ${file.path}`)
		}
		const source = this.#input.source
		let target = initial
		if (
			source !== undefined &&
			parent?.protocol === 'file:' &&
			containsArtifact(source.root, fileURLToPath(parent)) &&
			(specifier.startsWith('./') || specifier.startsWith('../'))
		) {
			target = new URL(specifier, parent)
			if (target.search !== '' || target.hash !== '')
				throw new ArtifactError(`Artifact source URL is unsupported: ${specifier}`)
			const path = fileURLToPath(target)
			if (!containsArtifact(source.root, path))
				throw new ArtifactError(`Artifact source dependency escapes its root: ${specifier}`)
			const extension = extname(path)
			if (extension === '.js' || extension === '.mjs') {
				const substitute = `${path.slice(0, -extension.length)}${extension === '.js' ? '.ts' : '.mts'}`
				if (this.#files.has(substitute)) {
					if (this.#files.has(path))
						throw new ArtifactError(`Artifact source target is ambiguous: ${path}`)
					target = pathToFileURL(substitute)
				}
			}
		}
		if (
			source !== undefined &&
			target?.protocol === 'file:' &&
			containsArtifact(source.root, fileURLToPath(target))
		) {
			if (
				parent !== undefined &&
				(parent.protocol !== 'file:' || !containsArtifact(source.root, fileURLToPath(parent))) &&
				initial?.searchParams.get('artifact') !== this.#input.token
			)
				throw new ArtifactError('Artifact built modules cannot import consumer sources')
			if (
				target.hash !== '' ||
				(target.search !== '' && target.search !== `?artifact=${this.#input.token}`)
			)
				throw new ArtifactError(`Artifact source URL is unsupported: ${target.href}`)
			const file = this.#files.get(fileURLToPath(target))
			if (file === undefined || !['.ts', '.mts', '.js', '.mjs'].includes(extname(file.path)))
				throw new ArtifactError(`Artifact source dependency is not admitted: ${target.href}`)
			if (readArtifact(file.path).digest !== file.digest)
				throw new ArtifactError(`Artifact dependency drifted: ${file.path}`)
			target.searchParams.set('artifact', this.#input.token)
			return {
				url: target.href,
				format: 'module',
				shortCircuit: true,
			}
		}
		const result = next(specifier, context)
		const url = new URL(result.url)
		if (
			url.protocol !== 'file:' ||
			url.hash !== '' ||
			(url.search !== '' && url.search !== `?artifact=${this.#input.token}`)
		)
			throw new ArtifactError(`Artifact URL is unsupported: ${result.url}`)
		url.search = ''
		const file = this.#files.get(fileURLToPath(url))
		if (
			file === undefined ||
			(source !== undefined && containsArtifact(source.root, file.path)) ||
			!['.js', '.mjs', '.json'].includes(extname(file.path)) ||
			(result.format !== 'module' && result.format !== 'json')
		)
			throw new ArtifactError(`Artifact dependency is not admitted ESM: ${result.url}`)
		if (readArtifact(file.path).digest !== file.digest)
			throw new ArtifactError(`Artifact dependency drifted: ${file.path}`)
		url.searchParams.set('artifact', this.#input.token)
		return { ...result, url: url.href }
	}

	/** Returns captured bytes after verifying their live disk identity.
	 * @param href - Node's resolved URL.
	 * @param context - Node's load context.
	 * @param next - The remaining native load chain.
	 * @returns Captured ESM, JSON, or native strip-only TypeScript output.
	 */
	load(href: string, context: LoadHookContext, next: ArtifactLoadHandler): LoadFnOutput {
		const url = new URL(href)
		if (url.searchParams.get('artifact') !== this.#input.token) return next(href, context)
		url.search = ''
		const file = this.#files.get(fileURLToPath(url))
		if (file === undefined || (context.format !== 'module' && context.format !== 'json'))
			throw new ArtifactError(`Artifact load is unsupported: ${href}`)
		if (readArtifact(file.path).digest !== file.digest)
			throw new ArtifactError(`Artifact dependency drifted: ${file.path}`)
		const extension = extname(file.path)
		return {
			format: context.format,
			source:
				extension === '.ts' || extension === '.mts'
					? stripTypeScriptTypes(Buffer.from(file.source).toString('utf8'), { mode: 'strip' })
					: new Uint8Array(file.source),
			shortCircuit: true,
		}
	}
}
