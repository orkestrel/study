import { createContract } from '@orkestrel/contract'
import { studyLabelAnswersShape, studyLabelPoolShape } from './shapers.js'

/** Validates what one labeler returns and publishes the JSON Schema that labeler fills. */
export const studyLabelAnswersContract = createContract(studyLabelAnswersShape)

/** Validates a pool a consumer kept between stages. */
export const studyLabelPoolContract = createContract(studyLabelPoolShape)
