import type { JSONValue } from '@orkestrel/contract'
import type { StudyEvidence, StudyAttempt } from '../../core/types.js'
import { attempt, isArray, isError, isRecord } from '@orkestrel/contract'
import { dirname } from 'node:path'
import { StudyError } from '../../core/errors.js'
import {
	parseStudyDefinition,
	parseStudyProfile,
	parseStudyRubric,
	parseStudyScenario,
} from '../../core/parsers.js'
import { isStudyErrorCode, isStudyJudgment } from '../../core/validators.js'
import { Artifacts } from '../artifacts/Artifacts.js'
import { readStudyAdapter } from '../adapters/helpers.js'
import { STUDY_CUSTODY_BYTES } from '../stores/constants.js'
import { hashStudyBytes, readStudyBytes } from '../stores/helpers.js'
import {
	isStudyCustodyAttempt,
	isStudyCustodyEvidence,
	isStudyCustodyManifest,
} from '../stores/validators.js'
import { STUDY_FRAME_BYTES } from './constants.js'
import { resolveStudyInstrument, validateStudyRuntime, toStudyWire } from './helpers.js'

/** Evaluates only admitted instrumentation in a disposable native child. */
export class StudyTaskWorker {
	/** Processes exactly one inherited request and returns a bounded response. */
	async execute(): Promise<void> {
		if (process.send === undefined || !process.connected)
			throw new StudyError('CONFIG', 'Adapter worker requires inherited IPC')
		process.channel?.ref()
		const value: unknown = await new Promise((resolve) => process.once('message', resolve))
		let response: JSONValue
		try {
			response = await this.#execute(value)
		} catch (error) {
			// A captured adapter evaluates its own copy of the study library, so its StudyError
			// class differs from this worker's; classify by validated shape instead of identity.
			const code = attempt(() =>
				isError(error) && error.name === 'StudyError' && 'code' in error ? error.code : undefined,
			)
			response = {
				error: error instanceof Error ? error.message : String(error),
				code: code.success && isStudyErrorCode(code.value) ? code.value : 'FAULT',
			}
		}
		if (Buffer.byteLength(JSON.stringify(response)) > STUDY_FRAME_BYTES)
			response = { error: 'Adapter result exceeds the frame allowance', code: 'FAULT' }
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
			!isArray(value.roots) ||
			!value.roots.every((root): root is string => typeof root === 'string') ||
			!isRecord(value.input)
		)
			throw new StudyError('CONFIG', 'Adapter request is malformed')
		const runtime = resolveStudyInstrument(value.entry)
		const roots = [...new Set([...value.roots, runtime])]
		validateStudyRuntime(runtime, roots)
		// Validation precedes subject and provider evaluation, so their selected entries stay
		// unreachable from every adapter import edge while shared admitted packages still load.
		const profile =
			value.operation === 'validate' ? parseStudyProfile(value.input.profile) : undefined
		const loader = new Artifacts({
			entries: [],
			roots,
			instrument: runtime,
			source: { root: dirname(value.adapter), entry: value.adapter },
			...(profile === undefined
				? {}
				: {
						excluded: [
							profile.subject,
							...(profile.provider === undefined ? [] : [profile.provider.entry]),
						],
					}),
		})
		const instrument = hashStudyBytes(
			new TextEncoder().encode(
				JSON.stringify([
					hashStudyBytes(await readStudyBytes(value.entry, STUDY_CUSTODY_BYTES)),
					loader.inspect().digest,
				]),
			),
		)
		const adapter = readStudyAdapter(await loader.load(value.adapter))
		let output: unknown
		if (profile !== undefined) {
			if (!isArray(value.input.scenarios))
				throw new StudyError('CONFIG', 'Adapter scenarios are invalid')
			adapter.validate({
				definition: parseStudyDefinition(value.input.definition),
				scenarios: value.input.scenarios.map(parseStudyScenario),
				rubric: parseStudyRubric(value.input.rubric),
				profile,
			})
			output = true
		} else if (value.operation === 'grade') {
			if (
				!isStudyCustodyManifest(value.input.manifest) ||
				!isArray(value.input.attempts) ||
				!isRecord(value.input.evidence)
			)
				throw new StudyError('CONFIG', 'Adapter grading input is invalid')
			const manifest = value.input.manifest
			const attempts: readonly unknown[] = value.input.attempts
			if (
				!attempts.every((attempt): attempt is StudyAttempt =>
					isStudyCustodyAttempt(attempt, manifest),
				)
			)
				throw new StudyError('CONFIG', 'Adapter attempts are invalid')
			const evidence: Record<string, readonly StudyEvidence[]> = {}
			for (const [trial, records] of Object.entries(value.input.evidence)) {
				if (!isArray(records) || !records.every(isStudyCustodyEvidence))
					throw new StudyError('CONFIG', 'Adapter evidence is invalid')
				evidence[trial] = records
			}
			output = adapter.grade({
				manifest,
				attempts,
				rubric: parseStudyRubric(value.input.rubric),
				evidence,
			})
			if (!isArray(output) || !output.every(isStudyJudgment))
				throw new StudyError('FAULT', 'Adapter returned invalid judgments')
		} else throw new StudyError('CONFIG', 'Unknown adapter operation')
		loader.verify()
		return toStudyWire({ instrument, value: output })
	}
}
