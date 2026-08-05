import fs from 'node:fs'
import { globSync } from 'glob'

const legacyImport = "var expand = require('brace-expansion')"
const compatibleImport = [
	"var braceExpansion = require('brace-expansion')",
	"var expand = typeof braceExpansion === 'function'",
	'\t? braceExpansion',
	'\t: braceExpansion.expand',
].join('\n')
let patched = 0

const installations = globSync('node_modules/**/minimatch/minimatch.js', {
	ignore: ['node_modules/**/node_modules/**/node_modules/**/node_modules/**'],
})

for (const filename of installations) {
	const source = fs.readFileSync(filename, 'utf8')
	if (source.includes(compatibleImport)) continue
	if (!source.includes(legacyImport)) continue
	fs.writeFileSync(filename, source.replace(legacyImport, compatibleImport))
	patched++
}

if (patched) {
	console.log(
		`Applied the brace-expansion 5 compatibility adapter to ${patched} legacy minimatch installation${patched === 1 ? '' : 's'}.`,
	)
}

// The patch matches an exact line of someone else's source, so it stops working
// the day that line changes — and a silently unpatched minimatch throws
// "expand is not a function" somewhere far from here, at whatever moment glob
// is first used. Anything unpatched and unpatchable is named now instead.
const unpatched = installations.filter(filename => {
	const source = fs.readFileSync(filename, 'utf8')
	return !source.includes(compatibleImport) && !source.includes(legacyImport)
})
if (unpatched.length) {
	console.error(
		[
			`Could not apply the brace-expansion 5 compatibility adapter to ${unpatched.length} minimatch installation${unpatched.length === 1 ? '' : 's'}:`,
			...unpatched.map(filename => `  ${filename}`),
			'',
			'These import brace-expansion in a form this patch does not recognise.',
			'The brace-expansion 5 override in package.json cannot work for them, so',
			'either the override or this patch needs revisiting.',
		].join('\n'),
	)
	process.exit(1)
}
