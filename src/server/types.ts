/**
 * Holds the first error a sink, a replay, or a transport retained, so a later call rethrows it.
 * @remarks
 * The wrapper keeps a thrown `undefined` apart from no retained error.
 */
export interface StudyFault {
	readonly error: unknown
}
