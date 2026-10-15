/** Declares one terminal record shape against the custody decision it must receive. */
export interface StudyExecutionCase {
	/** Names the case in the test title. */
	readonly name: string
	/** If `true`, custody accepts the attempt; if `false`, custody refuses it. */
	readonly valid: boolean
	/** Replaces the fields of a fully executed attempt for the compact scenario's two goals; malformed members stay unknown and inert. */
	readonly attempt: Readonly<Record<string, unknown>>
}
