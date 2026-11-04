import {
	arrayShape,
	booleanShape,
	integerShape,
	jsonShape,
	literalShape,
	objectShape,
	optionalShape,
	stringShape,
} from '@orkestrel/contract'
import { STUDY_NAME, STUDY_ROLES, STUDY_VERDICTS } from './constants.js'

/** Describes a portable bounded study identifier, the set `isStudyName` admits. */
export const studyNameShape = stringShape({ max: 128, pattern: STUDY_NAME })

/** Describes a nonblank text an author or a labeler fills. */
export const studyTextShape = stringShape({ pattern: /\S/ })

/** Describes a lowercase SHA-256 digest, the set `isStudyDigest` admits. */
export const studyDigestShape = stringShape({ pattern: /^[a-f0-9]{64}$/ })

/** Describes a canonical UTC millisecond timestamp's form; `scanStudyLabelsFaults` proves its instant. */
export const studyTimestampShape = stringShape({
	pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
})

/** Describes a nonnegative safe measurement. */
export const studyMeasurementShape = integerShape({ min: 0, max: Number.MAX_SAFE_INTEGER })

/** Describes one role's measured request usage; absent `tokens` and `bytes` stay unknown. */
export const studyUsageShape = objectShape({
	role: literalShape(STUDY_ROLES),
	calls: studyMeasurementShape,
	duration: studyMeasurementShape,
	tokens: optionalShape(studyMeasurementShape),
	bytes: optionalShape(studyMeasurementShape),
})

/** Describes a grader-owned criterion an author fills. */
export const studyCriterionShape = objectShape({
	id: studyNameShape,
	scenario: studyNameShape,
	goal: studyNameShape,
	method: literalShape(['state', 'trace', 'semantic']),
	critical: booleanShape(),
	assertion: jsonShape(),
})

/** Describes a versioned grading declaration; `scanStudyRubricFaults` holds what a shape cannot express. */
export const studyRubricShape = objectShape({
	version: studyTextShape,
	criteria: arrayShape(studyCriterionShape, { min: 1 }),
})

/** Describes an evidence-backed verdict; `scanStudyJudgmentFaults` holds what a shape cannot express. */
export const studyJudgmentShape = objectShape({
	trial: studyNameShape,
	criterion: studyNameShape,
	verdict: studyVerdictShape,
	method: literalShape(['state', 'trace', 'human', 'model']),
	reason: studyTextShape,
	references: arrayShape(studyTextShape),
})

/** Describes a judgment a person or a model fills, the one method pair imported labels admit. */
export const studyLabelJudgmentShape = objectShape({
	trial: studyNameShape,
	criterion: studyNameShape,
	verdict: studyVerdictShape,
	method: literalShape(['human', 'model']),
	reason: studyTextShape,
	references: arrayShape(studyTextShape),
})

/** Describes imported semantic labels; `scanStudyLabelsFaults` holds what a shape cannot express. */
export const studyLabelsShape = objectShape({
	packet: studyDigestShape,
	labeler: studyTextShape,
	version: studyTextShape,
	created: studyTimestampShape,
	usage: arrayShape(studyUsageShape),
	judgments: arrayShape(studyLabelJudgmentShape),
})
