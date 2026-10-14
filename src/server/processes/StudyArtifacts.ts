import type { StudyArtifactIdentity, StudyArtifactModules, StudyArtifactOptions } from './types.js'
import type { StudyAdapterInterface } from '../adapters/types.js'
import { dirname, isAbsolute } from 'node:path'
import { readFileSync } from 'node:fs'
import { StudyError } from '../../core/errors.js'
import { Artifacts } from '../artifacts/Artifacts.js'
import { readStudyAdapter } from '../adapters/helpers.js'
import { hashStudyBytes, readStudyBytes } from '../stores/helpers.js'
import { STUDY_CUSTODY_BYTES } from '../stores/constants.js'
import { resolveStudyInstrument, validateStudyRuntime } from './helpers.js'

/** Binds consumer instrumentation separately from selected executable identities. */
export class StudyArtifacts {
	#options: StudyArtifactOptions
	#loader: Artifacts | undefined
	#instrument: Artifacts | undefined
	#identity: StudyArtifactIdentity | undefined
	#entry: string | undefined
	/** Owns resolved built and consumer source selections.
	 * @param options - The trusted host, adapter, and profile.
	 */
	constructor(options: StudyArtifactOptions) {
		this.#options = structuredClone(options)
		if (
			![
				options.entry,
				options.root,
				options.adapter,
				options.profile.subject,
				...options.profile.roots,
				...(options.profile.provider === undefined ? [] : [options.profile.provider.entry]),
			].every(isAbsolute)
		)
			throw new StudyError('CONFIG', 'Study artifact paths must be absolute')
	}
	/** Inventories bytes without importing selected code.
	 * @returns Bound executable and instrumentation identities.
	 */
	async inspect(): Promise<StudyArtifactIdentity> {
		if (this.#identity !== undefined) {
			this.verify()
			return this.#identity
		}
		const profile = this.#options.profile
		const instrument = resolveStudyInstrument(this.#options.entry)
		const roots = [...new Set([...profile.roots, instrument])]
		validateStudyRuntime(instrument, roots)
		const source = { root: dirname(this.#options.adapter), entry: this.#options.adapter }
		this.#instrument = new Artifacts({ entries: [], roots, source, instrument })
		this.#entry = hashStudyBytes(await readStudyBytes(this.#options.entry, STUDY_CUSTODY_BYTES))
		this.#loader = new Artifacts({
			entries: [
				profile.subject,
				...(profile.provider === undefined ? [] : [profile.provider.entry]),
			],
			roots,
			source,
			instrument,
		})
		const inventory = this.#loader.inspect()
		this.#identity = Object.freeze({
			subject: inventory.digest,
			provider: profile.provider === undefined ? undefined : inventory.digest,
			instrument: hashStudyBytes(
				new TextEncoder().encode(JSON.stringify([this.#entry, this.#instrument.inspect().digest])),
			),
		})
		this.verify()
		return this.#identity
	}
	/** Loads the adapter from the trial inventory.
	 * @returns The complete consumer adapter.
	 */
	async adapter(): Promise<StudyAdapterInterface> {
		await this.inspect()
		if (this.#loader === undefined)
			throw new StudyError('CONFIG', 'Artifact inspection is required')
		return readStudyAdapter(await this.#loader.load(this.#options.adapter))
	}
	/** Loads admitted built namespaces inside the trial child.
	 * @returns The subject and optional provider.
	 */
	async load(): Promise<StudyArtifactModules> {
		await this.inspect()
		if (this.#loader === undefined)
			throw new StudyError('CONFIG', 'Artifact inspection is required')
		const subject = await this.#loader.load(this.#options.profile.subject)
		const provider =
			this.#options.profile.provider === undefined
				? undefined
				: await this.#loader.load(this.#options.profile.provider.entry)
		this.verify()
		return Object.freeze({ subject, provider })
	}
	/** Refuses instrument and inventory drift after inspection. */
	verify(): void {
		if (this.#loader === undefined || this.#instrument === undefined)
			throw new StudyError('CONFIG', 'Artifact inspection is required')
		if (hashStudyBytes(readFileSync(this.#options.entry)) !== this.#entry)
			throw new StudyError('FAULT', 'Study instrument bytes drifted')
		this.#loader.verify()
		this.#instrument.verify()
	}
}
