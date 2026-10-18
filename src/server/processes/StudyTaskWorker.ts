import type { JSONValue } from '@orkestrel/contract'
import type { StudyEvidence, StudyAttempt, StudyProfile } from '../../core/types.js'
import type { StudyAdapterInterface } from '../adapters/types.js'
import { arrayOf, isArray, isRecord, isString } from '@orkestrel/contract'
import { dirname } from 'node:path'
import { isStudyError, StudyError } from '../../core/errors.js'
import {
	parseStudyDefinition,
	parseStudyProfile,
	parseStudyRubric,
	parseStudyScenario,
} from '../../core/parsers.js'
import { isStudyJudgment } from '../../core/validators.js'
import { Artifacts } from '../artifacts/Artifacts.js'
import { readStudyAdapter } from '../adapters/helpers.js'
import { hashStudyBytes } from '../helpers.js'
import { STUDY_CUSTODY_BYTES } from '../stores/constants.js'
import { readStudyBytes } from '../stores/helpers.js'
import {
	isStudyCustodyAttempt,
	isStudyCustodyEvidence,
	isStudyCustodyManifest,
} from '../stores/validators.js'
import { STUDY_FRAME_BYTES } from './constants.js'
import {
	collectStudyEntries,
	computeStudyInstrumentDigest,
	resolveStudyInstrument,
	validateStudyRuntime,
	toStudyWire,
} from './helpers.js'

/** Evaluates only admitted instrumentation in a disposable native child. */
export class StudyTaskWorker {
	/** Processes exactly one inherited request and returns a bounded response. */
	async execute(): Promise<void> {
		if (process.send === undefined || !process.connected)
			throw new StudyError('CONFIG', 'Adapter worker requires inherited IPC')
		process.channel?.ref()
		const value: unknown = await new Promise((resolve) => process.once('message', resolve))
		const outcome = await this.#execute(value).catch((error: unknown): JSONValue => ({
			error: error instanceof Error ? error.message : String(error),
			code: isStudyError(error) ? error.code : 'FAULT',
		}))
		const response: JSONValue =
			Buffer.byteLength(JSON.stringify(outcome)) > STUDY_FRAME_BYTES
				? { error: 'Adapter result exceeds the frame allowance', code: 'FAULT' }
				: outcome
		await new Promise<void>((resolve, reject) =>
			process.send?.(response, (error: Error | null) =>
				error === null ? resolve() : reject(error),
			),
		)
	}
	async #execute(value: unknown): Promise<JSONValue> {
		if (
			!isRecord(value) ||
			Buffer.byteLength(JSON.stringify(value)) > STUDY_FRAME_BYTES ||
			typeof value.adapter !== 'string' ||
			typeof value.entry !== 'string' ||
			!arrayOf(isString)(value.roots) ||
			!isRecord(value.input)
		)
			throw new StudyError('CONFIG', 'Adapter request is malformed')
		const runtime = resolveStudyInstrument(value.entry)
		const roots = [...new Set([...value.roots, runtime])]
		validateStudyRuntime(runtime, roots)
		// Validation precedes agent, subject and provider evaluation, so their selected entries stay
		// unreachable from every adapter import edge while shared admitted packages still load.
		const profile =
			value.operation === 'validate' ? parseStudyProfile(value.input.profile) : undefined
		const loader = new Artifacts({
			entries: [],
			roots,
			instrument: runtime,
			source: { root: dirname(value.adapter), entry: value.adapter },
			...(profile === undefined ? {} : { excluded: collectStudyEntries(profile) }),
		})
		const instrument = computeStudyInstrumentDigest(
			hashStudyBytes(await readStudyBytes(value.entry, STUDY_CUSTODY_BYTES)),
			loader.inspect().digest,
		)
		const adapter = readStudyAdapter(await loader.load(value.adapter))
		if (profile === undefined && value.operation !== 'grade')
			throw new StudyError('CONFIG', 'Unknown adapter operation')
		const output: unknown =
			profile === undefined
				? this.#grade(adapter, value.input)
				: this.#validate(adapter, value.input, profile)
		loader.verify()
		return toStudyWire({ instrument, value: output })
	}

	#validate(
		adapter: StudyAdapterInterface,
		input: Readonly<Record<string, unknown>>,
		profile: StudyProfile,
	): true {
		if (!isArray(input.scenarios)) throw new StudyError('CONFIG', 'Adapter scenarios are invalid')
		adapter.validate({
			definition: parseStudyDefinition(input.definition),
			scenarios: input.scenarios.map(parseStudyScenario),
			rubric: parseStudyRubric(input.rubric),
			profile,
		})
		return true
	}

	#grade(adapter: StudyAdapterInterface, input: Readonly<Record<string, unknown>>): unknown {
		if (
			!isStudyCustodyManifest(input.manifest) ||
			!isArray(input.attempts) ||
			!isRecord(input.evidence)
		)
			throw new StudyError('CONFIG', 'Adapter grading input is invalid')
		const manifest = input.manifest
		const attempts: readonly unknown[] = input.attempts
		if (
			!attempts.every((retained): retained is StudyAttempt =>
				isStudyCustodyAttempt(retained, manifest),
			)
		)
			throw new StudyError('CONFIG', 'Adapter attempts are invalid')
		const evidence: Record<string, readonly StudyEvidence[]> = Object.fromEntries(
			Object.entries(input.evidence).map(([trial, records]) => {
				if (!isArray(records) || !records.every(isStudyCustodyEvidence))
					throw new StudyError('CONFIG', 'Adapter evidence is invalid')
				return [trial, records]
			}),
		)
		const output = adapter.grade({
			manifest,
			attempts,
			rubric: parseStudyRubric(input.rubric),
			evidence,
		})
		if (!isArray(output) || !output.every(isStudyJudgment))
			throw new StudyError('FAULT', 'Adapter returned invalid judgments')
		return output
	}
}
