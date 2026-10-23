import type { OllamaDaemonIdentity, OllamaDaemonInterface } from '@orkestrel/ollama/server'
import type { StudyTrial } from '@src/core'
import type { StudyDaemonSessionOptions } from './types.js'
import type { StudyExchangeDestination } from '../stores/types.js'
import { StudyError } from '@src/core'
import { canonicalStringify } from '@orkestrel/contract'
import { validateStudyRecordingDeclaration } from '../processes/helpers.js'
import { StudyDaemonTrial } from './StudyDaemonTrial.js'

/** Owns the declared daemon and its serial trial preparation through permanent cleanup.
 * @example
 * ```ts
 * const session = new StudyDaemonSession(options)
 * try { await session.start() } finally { await session.stop() }
 * ```
 */
export class StudyDaemonSession {
	readonly #options: StudyDaemonSessionOptions
	#daemon: OllamaDaemonInterface | undefined
	#stopped = false
	readonly #trials = new Set<StudyDaemonTrial>()

	/** Captures resolved declarations without loading the daemon runtime.
	 * @param options - The execution profile, scenarios, workspace, and cancellation.
	 */
	constructor(options: StudyDaemonSessionOptions) {
		const provider = options.profile.provider
		const daemon = provider?.daemon
		if (provider === undefined || daemon === undefined)
			throw new StudyError('CONFIG', 'Execution has no declared daemon')
		if (
			options.profile.record !== undefined &&
			options.profile.settings?.version !== daemon.version
		)
			throw new StudyError('CONFIG', 'Daemon and recording versions differ')
		this.#options = {
			...options,
			profile: structuredClone(options.profile),
			scenarios: structuredClone(options.scenarios),
		}
	}

	/** Starts the daemon and returns its verified execution provenance.
	 * @returns The executable, endpoint, owned pid, and model receipt.
	 */
	async start(): Promise<OllamaDaemonIdentity> {
		this.#options.signal.throwIfAborted()
		const { createOllamaDaemon } = await import('@orkestrel/ollama/server')
		if (this.#stopped) throw new StudyError('FAULT', 'Daemon session has stopped')
		const provider = this.#options.profile.provider
		const daemon = provider?.daemon
		if (provider === undefined || daemon === undefined)
			throw new StudyError('CONFIG', 'Execution has no declared daemon')
		this.#daemon ??= createOllamaDaemon({
			executable: { path: daemon.executable, digest: daemon.digest, version: daemon.version },
			url: provider.url,
			models: daemon.models,
			workspace: this.#options.workspace,
			...(daemon.environment === undefined ? {} : { environment: daemon.environment }),
			signal: this.#options.signal,
			readiness: this.#options.profile.bounds.request.duration,
			metadata: {
				timeout: this.#options.profile.bounds.request.duration,
				bytes: this.#options.profile.bounds.request.bytes,
			},
			fetch: (input, init) => this.#send(input, init),
		})
		return this.#daemon.start()
	}

	/** Unloads the declared population before opening one trial worker.
	 * @param trial - The scheduled trial.
	 * @param signal - The trial's cancellation.
	 * @param destination - The optional reserved recording destination.
	 * @returns The unchanged destination with its verified maintenance prefix when recording.
	 */
	async prepare(
		trial: StudyTrial,
		signal: AbortSignal,
		destination?: StudyExchangeDestination,
	): Promise<StudyExchangeDestination | undefined> {
		signal.throwIfAborted()
		const daemon = this.#daemon
		if (daemon === undefined) throw new StudyError('FAULT', 'Daemon startup is required')
		if (this.#trials.size !== 0) throw new StudyError('FAULT', 'Daemon preparations cannot overlap')
		if (destination === undefined) {
			if (this.#options.profile.record !== undefined)
				throw new StudyError('CUSTODY', 'Daemon maintenance requires its reserved sidecar')
			await daemon.unload()
			return undefined
		}
		const declaration = destination.declaration
		const models = this.#options.profile.provider?.daemon?.models
		const first = this.#options.scenarios.find((scenario) => scenario.id === trial.scenario)
			?.goals[0]
		validateStudyRecordingDeclaration(
			declaration,
			this.#options.profile,
			trial,
			this.#options.scenarios.find((scenario) => scenario.id === trial.scenario),
		)
		if (
			models === undefined ||
			first?.id !== declaration.goals[0] ||
			canonicalStringify(models) !== canonicalStringify(declaration.maintenance)
		)
			throw new StudyError('CONFIG', 'Maintenance must join the first declared goal')
		const preparation = new StudyDaemonTrial({
			destination,
			signal,
		})
		this.#trials.add(preparation)
		try {
			return await preparation.execute(daemon)
		} finally {
			this.#trials.delete(preparation)
		}
	}

	/** Stops and joins the owned tree and refuses an unconfirmed cleanup.
	 * @returns Completion after daemon and emitter teardown.
	 */
	async stop(): Promise<void> {
		this.#stopped = true
		const daemon = this.#daemon
		if (daemon === undefined) return
		const confirmed = await daemon.stop()
		await daemon.destroy()
		if (!confirmed) throw new StudyError('FAULT', 'Daemon cleanup was not confirmed')
	}

	#send(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Promise<Response> {
		for (const trial of this.#trials) return trial.fetch(input, init)
		return globalThis.fetch(input, init)
	}
}
