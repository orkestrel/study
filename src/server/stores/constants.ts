/** Limits untrusted metadata before JSON parsing or file allocation. */
export const STUDY_CUSTODY_BYTES = 16 * 1024 * 1024

/** Rejects names that Windows reserves even on other hosts. */
export const STUDY_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Discloses the limits of neutral identifiers when public text remains visible. */
export const STUDY_PACKET_DISCLOSURE =
	'Identifiers omit treatment and model names. Input and product text may still reveal design details.'
