import type {
	StudyAttempt,
	StudyFailure,
	StudyGoal,
	StudyObservation,
	StudyProduct,
	StudySeriesOptions,
	StudySessionInterface,
	StudySinkInterface,
	StudyTrial,
} from '../types.js'
import { Budget } from '@orkestrel/budget'
import { canonicalStringify, cloneJSONValue } from '@orkestrel/contract'
import { isStudyError, StudyError } from '../errors.js'
import { buildStudySchedule } from '../helpers.js'
import { isStudyBounds, isStudyProduct } from '../validators.js'
import { failureToStudyError, readStudyFailure } from './helpers.js'
import { StudyControl } from './StudyControl.js'
import { StudyDeadline } from './StudyDeadline.js'
import { StudyMeter } from './StudyMeter.js'
import { StudyScope } from './StudyScope.js'

/** Executes a frozen serial study schedule with finite admission and sticky failures. */
export class StudySeries {
	#options: StudySeriesOptions
	#executed = false

	/** Owns the declared inputs while retaining the concrete driver and custody store.
	 * @param options - Frozen manifest, concrete adapters, and parent cancellation.
	 */
	constructor(options: StudySeriesOptions) {
		this.#options = { ...options, manifest: structuredClone(options.manifest) }
	}

	/** Runs every declared trial once and retains explicit unexecuted observations after failure.
	 * Custody rejection leaves the run unsealed; callers must seal only a fulfilled execution.
	 * @returns Ordered terminal attempts without task success labels.
	 * @throws Thrown for invalid configuration or failed or timed out custody operations.
	 */
	async execute(): Promise<readonly StudyAttempt[]> {
		if (this.#executed) throw new StudyError('CONFIG', 'Study series can execute only once')
		this.#executed = true
		const manifest = this.#options.manifest
		const expected = buildStudySchedule(manifest.definition, manifest.scenarios)
		if (
			manifest.version !== 1 ||
			!isStudyBounds(manifest.bounds) ||
			canonicalStringify(expected) !== canonicalStringify(manifest.schedule)
		)
			throw new StudyError('CONFIG', 'Study manifest schedule or bounds are invalid')
		const control = new StudyControl(this.#options.signal)
		const scope = new StudyScope({ limit: manifest.bounds.series, control, label: 'Series' })
		const deadline = new StudyDeadline({
			duration: manifest.bounds.request.duration,
			label: 'Custody or cleanup',
		})
		const output = new Budget({
			max: manifest.bounds.series.bytes,
			consumer: (bytes: number) => bytes,
		})
		const attempts: StudyAttempt[] = []
		try {
			for (const trial of manifest.schedule)
				attempts.push(await this.#executeTrial(trial, control, scope, output, deadline))
		} finally {
			scope.close()
			control.close()
		}
		return Object.freeze(attempts)
	}

	async #executeTrial(
		trial: StudyTrial,
		control: StudyControl,
		series: StudyScope,
		output: Budget<number>,
		deadline: StudyDeadline,
	): Promise<StudyAttempt> {
		const started = performance.now()
		const scenario = this.#options.manifest.scenarios.find((entry) => entry.id === trial.scenario)
		if (scenario === undefined) throw new StudyError('CONFIG', 'Scheduled scenario is absent')
		const observations: StudyObservation[] = []
		let session: StudySessionInterface | undefined
		let opening: Promise<StudySessionInterface> | undefined
		let scope: StudyScope | undefined
		let evidence: StudySinkInterface | undefined
		let cleanup: StudyFailure | undefined
		const prior = control.failure
		try {
			if (control.failure === undefined) {
				series.check()
				scope = new StudyScope({
					limit: this.#options.manifest.bounds.trial,
					control,
					label: 'Trial',
				})
				evidence = await this.#start(trial, control, deadline)
				series.check()
				scope.check()
				opening = this.#open(trial, control, deadline)
				session = await control.wait(opening)
			} else evidence = await this.#start(trial, control, deadline)
			const trialOutput = new Budget({
				max: this.#options.manifest.bounds.trial.bytes,
				consumer: (bytes: number) => bytes,
			})
			for (const goal of scenario.goals) {
				if (
					control.failure !== undefined ||
					session === undefined ||
					scope === undefined ||
					evidence === undefined
				)
					break
				series.check()
				scope.check()
				observations.push(
					await this.#executeGoal(
						goal,
						session,
						evidence,
						control,
						[scope, series],
						[trialOutput, output],
					),
				)
			}
		} catch (error) {
			if (isStudyError(error) && error.code === 'CUSTODY') throw error
			control.fail(readStudyFailure(error))
		} finally {
			if (session !== undefined) {
				try {
					await deadline.wait(session.close())
				} catch (error) {
					cleanup = readStudyFailure(error)
					control.fail(cleanup)
				}
			} else if (opening !== undefined) {
				try {
					const late = await deadline.wait(opening)
					await deadline.wait(late.close())
				} catch (error) {
					const late = readStudyFailure(error)
					if (late.message !== control.failure?.message) cleanup = late
				}
			}
			scope?.close()
			try {
				series.check()
			} catch (error) {
				control.fail(readStudyFailure(error))
			}
		}
		const failure = control.failure
		for (const goal of scenario.goals.slice(observations.length)) {
			const unexecuted: StudyFailure =
				failure === undefined
					? {
							cause: 'infrastructure',
							message: 'Goal unexecuted because the trial did not open',
							role: undefined,
						}
					: { ...failure, message: `Goal unexecuted: ${failure.message}` }
			observations.push(
				Object.freeze({
					goal: goal.id,
					product: undefined,
					failure: unexecuted,
					usage: Object.freeze([]),
					duration: 0,
				}),
			)
		}
		const attempt: StudyAttempt = Object.freeze({
			trial,
			observations: Object.freeze(observations),
			failure:
				cleanup !== undefined &&
				failure !== undefined &&
				(prior !== undefined || failure.message !== cleanup.message)
					? { ...failure, message: `${failure.message}; cleanup: ${cleanup.message}` }
					: failure,
			duration: Math.ceil(performance.now() - started),
		})
		try {
			await deadline.wait(this.#options.store.finish(attempt))
			if (attempt.failure === undefined) series.check()
		} catch (error) {
			control.fail(readStudyFailure(error))
			const custody = control.failure ?? readStudyFailure(error)
			throw new StudyError('CUSTODY', custody.message, custody)
		}
		return attempt
	}

	async #executeGoal(
		goal: StudyGoal,
		session: StudySessionInterface,
		evidence: StudySinkInterface,
		control: StudyControl,
		parents: readonly StudyScope[],
		outputs: ReadonlyArray<Budget<number>>,
	): Promise<StudyObservation> {
		const started = performance.now()
		const bounds = this.#options.manifest.bounds
		const scope = new StudyScope({ limit: bounds.goal, control, label: 'Goal' })
		const meter = new StudyMeter({ request: bounds.request, scopes: [scope, ...parents], control })
		let product: StudyProduct | undefined
		try {
			const value: unknown = await control.wait(
				session.execute(goal, { signal: control.signal, meter, evidence }),
			)
			if (!isStudyProduct(value))
				throw new StudyError('FAULT', 'Driver returned no valid study product')
			product = Object.freeze({ value: cloneJSONValue(value.value), partial: value.partial })
			for (const parent of parents) parent.check()
			scope.check()
			const bytes = new TextEncoder().encode(JSON.stringify(product.value)).byteLength
			if (bytes > bounds.goal.bytes || outputs.some((budget) => bytes > budget.remaining)) {
				product = undefined
				control.fail({
					cause: 'capacity',
					message: 'Study product exceeded its output allowance',
					role: undefined,
				})
			} else for (const budget of outputs) budget.consume(bytes)
		} catch (error) {
			control.fail(readStudyFailure(error))
		} finally {
			meter.close()
			scope.close()
		}
		return Object.freeze({
			goal: goal.id,
			product,
			failure: control.failure,
			usage: meter.usage,
			duration: Math.ceil(performance.now() - started),
		})
	}

	async #open(
		trial: StudyTrial,
		control: StudyControl,
		deadline: StudyDeadline,
	): Promise<StudySessionInterface> {
		const session = await this.#options.driver.open(trial, control.signal)
		if (control.failure !== undefined) {
			await deadline.wait(session.close())
			throw failureToStudyError(control.failure)
		}
		return session
	}

	async #start(
		trial: StudyTrial,
		control: StudyControl,
		deadline: StudyDeadline,
	): Promise<StudySinkInterface> {
		try {
			const pending = this.#options.store.start(trial)
			return control.failure === undefined
				? await control.wait(pending)
				: await deadline.wait(pending)
		} catch (error) {
			control.fail(readStudyFailure(error))
			const failure = control.failure ?? readStudyFailure(error)
			throw new StudyError('CUSTODY', failure.message, failure)
		}
	}
}
