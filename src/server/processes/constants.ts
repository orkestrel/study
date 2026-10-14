/** Limits each serialized IPC envelope, including its JSON framing. */
export const STUDY_FRAME_BYTES = 16 * 1024 * 1024

/** Limits outstanding bidirectional protocol work per process. */
export const STUDY_PENDING_LIMIT = 64

/** Limits combined worker stdout and stderr before termination. */
export const STUDY_LOG_BYTES = 64 * 1024

/** Names the worker operation routed by the built application entry. */
export const STUDY_WORKER_OPERATION = 'study-worker'

/** Names the private bounded validation and grading route. */
export const STUDY_TASK_OPERATION = 'study-adapter'

/** Names the command route beneath the native supervisor. */
export const STUDY_COMMAND_OPERATION = 'study-command'

/** Caps pure domain work independently of its event loop. */
export const STUDY_TASK_DURATION = 60000
