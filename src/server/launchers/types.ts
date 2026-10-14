/** Selects the native command entry and the caller's consumer root. */
export interface StudyLaunchOptions {
	readonly root: string
	readonly entry: string
}

/** Retains the bounded command exit and captured output. */
export interface StudyLaunchResult {
	readonly code: number
	readonly output: string
}
