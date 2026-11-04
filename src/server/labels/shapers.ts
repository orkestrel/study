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
import { studyDigestShape, studyTextShape } from '@src/core'

/** Describes a verdict a labeler answers. */
export const studyLabelVerdictShape = literalShape(['achieved', 'unsuccessful', 'unknown'])

/** Describes a one-based neutral row number. */
export const studyLabelNumberShape = integerShape({ min: 1, max: Number.MAX_SAFE_INTEGER })

/** Describes a zero-based request index. */
export const studyLabelIndexShape = integerShape({ min: 0, max: Number.MAX_SAFE_INTEGER })

/** Describes one row a labeler returns; the pattern on `reason` refuses a blank reason at the tool call. */
export const studyLabelAnswerShape = objectShape({
	row: studyLabelNumberShape,
	verdict: studyLabelVerdictShape,
	reason: studyTextShape,
	revealed: optionalShape(booleanShape()),
})

/** Describes what one labeler returns for one request. */
export const studyLabelAnswersShape = objectShape({ rows: arrayShape(studyLabelAnswerShape) })

/** Describes a pool's blind requests and its separate map, so a consumer can keep one between stages. */
export const studyLabelPoolShape = objectShape({
	requests: arrayShape(
		objectShape({
			rows: arrayShape(
				objectShape({
					row: studyLabelNumberShape,
					input: jsonShape(),
					product: optionalShape(jsonShape()),
					assertion: jsonShape(),
				}),
			),
		}),
	),
	map: objectShape({
		links: arrayShape(
			objectShape({
				row: studyLabelNumberShape,
				request: studyLabelIndexShape,
				packet: studyDigestShape,
				result: stringShape({ min: 1 }),
				arm: stringShape({ min: 1 }),
				trial: stringShape({ min: 1 }),
				criterion: stringShape({ min: 1 }),
				source: objectShape({
					trial: stringShape({ min: 1 }),
					criterion: stringShape({ min: 1 }),
				}),
				goal: stringShape({ min: 1 }),
				class: stringShape({ min: 1 }),
			}),
		),
		checks: arrayShape(
			objectShape({
				row: studyLabelNumberShape,
				request: studyLabelIndexShape,
				verdict: studyLabelVerdictShape,
			}),
		),
	}),
})
