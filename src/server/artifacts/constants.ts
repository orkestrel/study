/** Bounds admitted files before another capture is allocated. */
export const ARTIFACT_FILES = 8192

/** Bounds all captured input bytes to 128 MiB. */
export const ARTIFACT_BYTES = 128 * 1024 * 1024

/** Bounds one captured input file to 16 MiB. */
export const ARTIFACT_FILE_BYTES = 16 * 1024 * 1024

/** Bounds all visited directory entries, including ignored assets. */
export const ARTIFACT_VISITS = 32768

/** Bounds directory nesting below each selected root. */
export const ARTIFACT_DEPTH = 64

/** Bounds selected package roots before traversal begins. */
export const ARTIFACT_ROOTS = 128
