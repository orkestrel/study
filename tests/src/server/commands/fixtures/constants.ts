import { hashStudyBytes } from '@orkestrel/study/server'

/** Identifies the server helper evaluated by the isolated captured source adapter. */
export const STUDY_SERVER_DIGEST = hashStudyBytes('captured-server')
