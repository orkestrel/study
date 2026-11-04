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

/** Checks whether a value holds a retained mapping's result and links. */
export const isStudyLabelMapping = objectOf({
	result: isString,
	entries: arrayOf(
		objectOf({
			trial: isString,
			criterion: isString,
			source: objectOf({ trial: isString, criterion: isString }),
		}),
	),
})
