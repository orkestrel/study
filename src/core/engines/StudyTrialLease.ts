import type {
	StudyFailure,
	StudySeriesOptions,
	StudySessionInterface,
	StudySinkInterface,
	StudyTrial,
} from '../types.js'
import type { StudyControl } from './StudyControl.js'
import type { StudyDeadline } from './StudyDeadline.js'
import { StudyError } from '../errors.js'
import { failureToStudyError, readStudyFailure } from './helpers.js'
import { StudyScope } from './StudyScope.js'

/** Holds one trial's evidence custody, admission scope and driver session from opening to cleanup. */
export class StudyTrialLease {
	readonly #trial: StudyTrial
	readonly #options: StudySeriesOptions
	readonly #control: StudyControl
	readonly #series: StudyScope
	readonly #deadline: StudyDeadline
	#scope: StudyScope | undefined
	#evidence: StudySinkInterface | undefined
	#opening: Promise<StudySessionInterface> | undefined
	#session: StudySessionInterface | undefined

	/** Binds one scheduled trial to the series' owned inputs, failure owner, series scope and cleanup deadline.
	 * @param trial - The scheduled trial.
	 * @param options - The series' owned manifest, driver and store.
	 * @param control - The series failure owner.
	 * @param series - The series admission scope.
	 * @param deadline - The custody and cleanup deadline.
	 */
	constructor(
		trial: StudyTrial,
		options: StudySeriesOptions,
		control: StudyControl,
		series: StudyScope,
		deadline: StudyDeadline,
	) {
		this.#trial = trial
		this.#options = options
		this.#control = control
		this.#series = series
		this.#deadline = deadline
	}

	/** Reports the trial scope after opening; undefined when the trial inherited a failure. */
	get scope(): StudyScope | undefined {
		return this.#scope
	}

	/** Reports the trial's evidence sink after custody starts. */
	get evidence(): StudySinkInterface | undefined {
		return this.#evidence
	}

	/** Reports the driver session after it opens. */
	get session(): StudySessionInterface | undefined {
		return this.#session
	}

	/** Starts evidence custody and, unless a failure is latched, opens the trial scope and driver session.
	 * @returns Nothing after the session opened, or after custody alone started under a latched failure.
	 * @throws StudyError - Thrown with code `CUSTODY` when custody refuses the trial; thrown for a series or trial limit or an opening failure.
	 */
	async open(): Promise<void> {
		const control = this.#control
		if (control.failure !== undefined) {
			this.#evidence = await this.#start()
			return
		}
		this.#series.check()
		const scope = new StudyScope({
			limit: this.#options.manifest.bounds.trial,
			control,
			label: 'Trial',
		})
		this.#scope = scope
		this.#evidence = await this.#start()
		this.#series.check()
		scope.check()
		const opening = this.#launch()
		this.#opening = opening
		this.#session = await control.wait(opening)
	}

	/** Closes the opened session, or a session that opened late, then the trial scope.
	 * @returns The cleanup failure, or undefined when cleanup succeeded or repeated the latched failure.
	 */
	async close(): Promise<StudyFailure | undefined> {
		const cleanup = await this.#release()
		this.#scope?.close()
		return cleanup
	}

	// Closes the session or awaits and closes a late opening; a session close failure is latched, a late one only reported when it differs.
	async #release(): Promise<StudyFailure | undefined> {
		const session = this.#session
		const opening = this.#opening
		if (session !== undefined) {
			try {
				await this.#deadline.wait(session.close())
				return undefined
			} catch (error) {
				const cleanup = readStudyFailure(error)
				this.#control.fail(cleanup)
				return cleanup
			}
		}
		if (opening === undefined) return undefined
		try {
			const late = await this.#deadline.wait(opening)
			await this.#deadline.wait(late.close())
			return undefined
		} catch (error) {
			const late = readStudyFailure(error)
			return late.message !== this.#control.failure?.message ? late : undefined
		}
	}

	// Opens the driver session; a failure latched while it opened closes it and refuses.
	async #launch(): Promise<StudySessionInterface> {
		const control = this.#control
		const session = await this.#options.driver.open(this.#trial, control.signal)
		if (control.failure !== undefined) {
			await this.#deadline.wait(session.close())
			throw failureToStudyError(control.failure)
		}
		return session
	}

	// Starts evidence custody; a refusal latches the failure and surfaces as a custody error.
	async #start(): Promise<StudySinkInterface> {
		const control = this.#control
		try {
			const pending = this.#options.store.start(this.#trial)
			return control.failure === undefined
				? await control.wait(pending)
				: await this.#deadline.wait(pending)
		} catch (error) {
			control.fail(readStudyFailure(error))
			const failure = control.failure ?? readStudyFailure(error)
			throw new StudyError('CUSTODY', failure.message, failure)
		}
	}
}
