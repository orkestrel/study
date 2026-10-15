import type { StudyEvidence } from '../../../../src/core/types.js'

/** Holds evidence arrays with absent retained positions. */
export interface StudySparseEvidence {
	readonly lone: readonly StudyEvidence[]
	readonly tail: readonly StudyEvidence[]
	readonly interior: readonly StudyEvidence[]
}

/** Answers one fixture chat request from its exact bytes, or declines so the default answer applies. */
export type StudyMCPAnswer = (path: string, body: string) => string | undefined

/** Names how a loopback proxy interferes with a `tools/call` request while it forwards all else. */
export type StudyMCPInterference = 'status' | 'reset' | 'held' | 'invalid' | 'error'

/** Holds a loopback proxy in front of a real MCP server that interferes only with `tools/call`. */
export interface StudyMCPProxy {
	/** Holds the endpoint the subject's client posts to. */
	readonly url: string
	/** Holds the JSON-RPC id of each interfered `tools/call`, in arrival order. */
	readonly intercepted: readonly unknown[]
	/** Destroys held and open connections, then stops the proxy. */
	close(): Promise<void>
}

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
