/** Bounds each supervised operation other than execution to 60 seconds. */
export const STUDY_LAUNCH_DURATION = 60000

/** Extends supervised execution beyond its declared series duration for cleanup. */
export const STUDY_LAUNCH_CLEANUP = 15000

/** Bounds combined supervised command output to 16 MiB before terminating the tree. */
export const STUDY_LAUNCH_BYTES = 16 * 1024 * 1024
