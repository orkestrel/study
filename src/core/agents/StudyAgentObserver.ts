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
import { isNonEmptyString } from '@orkestrel/contract'
import { StudyError } from '../errors.js'
import { projectStudyAgentRequest, validateStudyAgentUsage } from './helpers.js'

/** Reads each Agent request's size before delegating it unchanged to the real provider. */
export class StudyAgentObserver implements ProviderInterface {
	readonly #options: StudyAgentObserverOptions
	readonly #model: string

	/** Binds the real provider, the measuring runtime, the explicit gauge and usage policy, and the reading recorder.
	 * @remarks
	 * Reads the delegate's `model` once, here, because Agent 0.0.46's `ProviderInterface` declares no `model`.
	 * @param options - Delegate, measurement seam, and policies.
	 * @throws StudyError - Thrown with code `CONFIG` when the delegate carries no non-empty string `model`.
	 */
	constructor(options: StudyAgentObserverOptions) {
		this.#options = { ...options }
		const provider = this.#options.provider
		const model = 'model' in provider ? provider.model : undefined
		if (!isNonEmptyString(model))
			throw new StudyError(
				'CONFIG',
				'Observer delegate lacks a non-empty string model: provider.model must name the model it serves',
			)
		this.#model = model
	}

	/** Reports the delegate's trace label. */
	get id(): string {
		return this.#options.provider.id
	}

	/** Reports the delegate's backend name. */
	get name(): string {
		return this.#options.provider.name
	}

	/** Reports the model the delegate named at construction. */
	get model(): string {
		return this.#model
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
