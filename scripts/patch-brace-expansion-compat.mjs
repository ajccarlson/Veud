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

for (const filename of globSync('node_modules/**/minimatch/minimatch.js', {
	ignore: ['node_modules/**/node_modules/**/node_modules/**/node_modules/**'],
})) {
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
