import { arrayOf, isJSONValue, isString, objectOf } from '@orkestrel/contract'

/** Checks whether a value holds a retained packet's entries. */
export const isStudyLabelPacket = objectOf({
	entries: arrayOf(
		objectOf(
			{
				trial: isString,
				criterion: isString,
				input: isJSONValue,
				product: isJSONValue,
				assertion: isJSONValue,
			},
			['product'],
		),
	),
})

/** Checks whether a value holds a retained legend's result and links, the content of a packet's `<packet>.mapping.json`. */
export const isStudyLabelLegend = objectOf({
	result: isString,
	entries: arrayOf(
		objectOf({
			trial: isString,
			criterion: isString,
			source: objectOf({ trial: isString, criterion: isString }),
		}),
	),
})
