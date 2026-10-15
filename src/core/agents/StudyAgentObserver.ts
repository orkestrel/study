import type {
	Message,
	ProviderDelta,
	ProviderInterface,
	ProviderRequest,
	ProviderResult,
	ProviderStreamOptions,
	ThinkingReplay,
} from '@orkestrel/agent'
import type { StudyAgentObserverOptions } from './types.js'
import { projectStudyAgentRequest, validateStudyAgentUsage } from './helpers.js'

/** Reads each Agent request's size before delegating it unchanged to the real provider. */
export class StudyAgentObserver implements ProviderInterface {
	readonly #options: StudyAgentObserverOptions

	/** Binds the real provider, the measuring runtime, the explicit gauge and usage policy, and the reading recorder.
	 * @param options - Delegate, measurement seam, and policies.
	 */
	constructor(options: StudyAgentObserverOptions) {
		this.#options = { ...options }
	}

	/** Reports the delegate's trace label. */
	get id(): string {
		return this.#options.provider.id
	}

	/** Reports the delegate's backend name. */
	get name(): string {
		return this.#options.provider.name
	}

	/** Reports the delegate's thinking replay policy; an absent policy is the declared `none`. */
	get replay(): ThinkingReplay {
		return this.#options.provider.replay ?? 'none'
	}

	/** Records one reading, then awaits the real generation.
	 * @param messages - The conversation sent.
	 * @param signal - Bounds the request.
	 * @param tools - The tools advertised this turn.
	 * @param options - The per-call options.
	 * @returns The real provider's result.
	 */
	async generate(
		messages: readonly Message[],
		signal: AbortSignal,
		tools?: ProviderRequest['tools'],
		options?: ProviderStreamOptions,
	): Promise<ProviderResult> {
		this.#measure(messages, tools, options)
		const result = await this.#options.provider.generate(messages, signal, tools, options)
		if (this.#options.enforced && !signal.aborted) validateStudyAgentUsage(result.usage, 'agent')
		return result
	}

	/** Records one reading, then relays the real stream.
	 * @param messages - The conversation sent.
	 * @param signal - Bounds the request.
	 * @param tools - The tools advertised this turn.
	 * @param options - The per-call options.
	 * @returns The real deltas and result.
	 */
	stream(
		messages: readonly Message[],
		signal: AbortSignal,
		tools?: ProviderRequest['tools'],
		options?: ProviderStreamOptions,
	): AsyncGenerator<ProviderDelta, ProviderResult> {
		this.#measure(messages, tools, options)
		return this.#relay(this.#options.provider.stream(messages, signal, tools, options), signal)
	}

	// Forms the pre-encoding request exactly as the Agent window measures it: omitted members stay omitted.
	#measure(
		messages: readonly Message[],
		tools: ProviderRequest['tools'],
		options: ProviderStreamOptions | undefined,
	): void {
		const request: ProviderRequest = {
			messages,
			...(tools === undefined ? {} : { tools }),
			...(options === undefined ? {} : { options }),
		}
		const estimate = this.#options.runtime.estimateRequest(request)
		const gauge = this.#options.gauge
		const projected = gauge === undefined ? undefined : projectStudyAgentRequest(gauge, estimate)
		this.#options.record({ estimate, projected }, request)
	}

	async *#relay(
		source: AsyncGenerator<ProviderDelta, ProviderResult>,
		signal: AbortSignal,
	): AsyncGenerator<ProviderDelta, ProviderResult> {
		const result = yield* source
		if (this.#options.enforced && !signal.aborted) validateStudyAgentUsage(result.usage, 'agent')
		return result
	}
}
