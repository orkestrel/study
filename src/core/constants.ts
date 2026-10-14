/** Caps a declared trial population before schedule allocation. */
export const STUDY_TRIALS = 4096

/** Caps a declared scenario horizon before execution. */
export const STUDY_GOALS = 4096

/** Restricts identifiers to portable path-safe names. */
export const STUDY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
