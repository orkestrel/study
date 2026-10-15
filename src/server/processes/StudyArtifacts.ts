import type { StudyArtifactIdentity, StudyArtifactModules, StudyArtifactOptions } from './types.js'
import type { StudyAdapterInterface } from '../adapters/types.js'
import { dirname, isAbsolute } from 'node:path'
import { readFileSync } from 'node:fs'
import { StudyError } from '../../core/errors.js'
import { Artifacts } from '../artifacts/Artifacts.js'
import { readStudyAdapter } from '../adapters/helpers.js'
import { hashStudyBytes } from '../helpers.js'
import { readStudyBytes } from '../stores/helpers.js'
import { STUDY_CUSTODY_BYTES } from '../stores/constants.js'
import {
	collectStudyEntries,
	computeStudyInstrumentDigest,
	resolveStudyInstrument,
	validateStudyRuntime,
} from './helpers.js'

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
				...collectStudyEntries(options.profile),
				...options.profile.roots,
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
		const entry = hashStudyBytes(await readStudyBytes(this.#options.entry, STUDY_CUSTODY_BYTES))
		this.#entry = entry
		this.#loader = new Artifacts({
			entries: collectStudyEntries(profile),
			roots,
			source,
			instrument,
		})
		const inventory = this.#loader.inspect()
		this.#identity = Object.freeze({
			agent: inventory.digest,
			subject: inventory.digest,
			provider: profile.provider === undefined ? undefined : inventory.digest,
			instrument: computeStudyInstrumentDigest(entry, this.#instrument.inspect().digest),
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
	 * @returns The agent, subject and optional provider; a shared entry loads once and keeps each role.
	 */
	async load(): Promise<StudyArtifactModules> {
		await this.inspect()
		if (this.#loader === undefined)
			throw new StudyError('CONFIG', 'Artifact inspection is required')
		const profile = this.#options.profile
		const namespaces = new Map<string, unknown>()
		for (const entry of collectStudyEntries(profile))
			namespaces.set(entry, await this.#loader.load(entry))
		this.verify()
		const provider = profile.provider
		return Object.freeze({
			agent: namespaces.get(profile.agent),
			subject: namespaces.get(profile.subject),
			provider: provider === undefined ? undefined : namespaces.get(provider.entry),
		})
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
