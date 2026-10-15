/** Answers one fixture chat request from its exact bytes, or declines so the default answer applies. */
export type StudyMCPAnswer = (path: string, body: string) => string | undefined

/** Holds a real loopback MCP server owned by the parent test, with the receipts it recorded. */
export interface StudyMCPFixture {
	/** Holds the Streamable-HTTP endpoint the subject's client posts to. */
	readonly url: string
	/** Holds the arguments of each executed `lookup` call, in arrival order. */
	readonly calls: ReadonlyArray<Readonly<Record<string, unknown>>>
	/** Holds the JSON-RPC method of each received POST, in arrival order. */
	readonly methods: readonly string[]
	/** Stops the server and releases its tools. */
	close(): Promise<void>
}
