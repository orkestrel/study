import { createContract } from '@orkestrel/contract'
import { studyJudgmentShape, studyLabelsShape, studyRubricShape } from './shapers.js'

/** Validates a grading declaration and publishes the JSON Schema an author fills. */
export const studyRubricContract = createContract(studyRubricShape)

/** Validates one judgment and publishes the JSON Schema a grader fills. */
export const studyJudgmentContract = createContract(studyJudgmentShape)

/** Validates imported labels and publishes the JSON Schema a person or a model fills. */
export const studyLabelsContract = createContract(studyLabelsShape)
