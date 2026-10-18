import type {
	StudyAttempt,
	StudyFailure,
	StudyGoal,
	StudyObservation,
	StudyProduct,
	StudyScenario,
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
import { readStudyFailure } from './helpers.js'
import { StudyControl } from './StudyControl.js'
import { StudyDeadline } from './StudyDeadline.js'
import { StudyMeter } from './StudyMeter.js'
import { StudyScope } from './StudyScope.js'
import { StudyTrialLease } from './StudyTrialLease.js'

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
		const prior = control.failure
		const lease = new StudyTrialLease(trial, this.#options, control, series, deadline)
		const executed = await this.#executeGoals(scenario, lease, control, series, output)
		const cleanup = await this.#release(lease, control, series)
		const failure = control.failure
		const observations: readonly StudyObservation[] = [
			...executed,
			...scenario.goals.slice(executed.length).map((goal): StudyObservation => {
				const unexecuted: StudyFailure =
					failure === undefined
						? {
								cause: 'infrastructure',
								message: 'Goal unexecuted because the trial did not open',
								role: undefined,
							}
						: { ...failure, message: `Goal unexecuted: ${failure.message}` }
				return Object.freeze({
					goal: goal.id,
					product: undefined,
					failure: unexecuted,
					usage: Object.freeze([]),
					duration: 0,
					executed: false,
				})
			}),
		]
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
			// The trial entered execution unless it inherited a terminal series failure at its
			// boundary. This does not claim that driver.open ran.
			executed: prior === undefined,
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

	// Opens the lease and executes each goal while the trial stays open; a custody refusal releases the lease before it propagates.
	async #executeGoals(
		scenario: StudyScenario,
		lease: StudyTrialLease,
		control: StudyControl,
		series: StudyScope,
		output: Budget<number>,
	): Promise<readonly StudyObservation[]> {
		const observations: StudyObservation[] = []
		try {
			await lease.open()
			const trialOutput = new Budget({
				max: this.#options.manifest.bounds.trial.bytes,
				consumer: (bytes: number) => bytes,
			})
			for (const goal of scenario.goals) {
				const { session, scope, evidence } = lease
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
			if (isStudyError(error) && error.code === 'CUSTODY') {
				await this.#release(lease, control, series)
				throw error
			}
			control.fail(readStudyFailure(error))
		}
		return observations
	}

	// Closes the lease, then rechecks the series ceiling, and returns the lease's cleanup failure.
	async #release(
		lease: StudyTrialLease,
		control: StudyControl,
		series: StudyScope,
	): Promise<StudyFailure | undefined> {
		const cleanup = await lease.close()
		try {
			series.check()
		} catch (error) {
			control.fail(readStudyFailure(error))
		}
		return cleanup
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
		const product = await this.#produce(
			goal,
			session,
			evidence,
			control,
			scope,
			meter,
			parents,
			outputs,
		)
		return Object.freeze({
			goal: goal.id,
			product,
			failure: control.failure,
			usage: meter.usage,
			duration: Math.ceil(performance.now() - started),
			executed: true,
		})
	}

	// Runs one goal and closes its meter and scope; a late check failure leaves the retained product in place.
	async #produce(
		goal: StudyGoal,
		session: StudySessionInterface,
		evidence: StudySinkInterface,
		control: StudyControl,
		scope: StudyScope,
		meter: StudyMeter,
		parents: readonly StudyScope[],
		outputs: ReadonlyArray<Budget<number>>,
	): Promise<StudyProduct | undefined> {
		const bounds = this.#options.manifest.bounds
		try {
			const value: unknown = await control.wait(
				session.execute(goal, { signal: control.signal, meter, evidence }),
			)
			if (!isStudyProduct(value))
				throw new StudyError('FAULT', 'Driver returned no valid study product')
			const candidate = Object.freeze({
				value: cloneJSONValue(value.value),
				partial: value.partial,
			})
			const bytes = new TextEncoder().encode(JSON.stringify(candidate.value)).byteLength
			const product =
				bytes <= bounds.goal.bytes && outputs.every((budget) => bytes <= budget.remaining)
					? candidate
					: undefined
			try {
				for (const parent of parents) parent.check()
				scope.check()
				if (product === undefined) {
					control.fail({
						cause: 'capacity',
						message: 'Study product exceeded its output allowance',
						role: undefined,
					})
				} else for (const budget of outputs) budget.consume(bytes)
			} catch (error) {
				control.fail(readStudyFailure(error))
			}
			return product
		} catch (error) {
			control.fail(readStudyFailure(error))
			return undefined
		} finally {
			meter.close()
			scope.close()
		}
	}
}
