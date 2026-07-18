import { type Meta, type Transformer } from '@sly-cli/sly'

const transformIcon: Transformer = (input, meta) => {
	input = prependLicenseInfo(input, meta)

	return input
}

export default transformIcon

function prependLicenseInfo(input: string, meta: Meta): string {
	return [
		`<!-- Downloaded from ${meta.name} -->`,
		`<!-- License ${meta.license} -->`,
		`<!-- ${meta.source} -->`,
		input,
	].join('\n')
}
