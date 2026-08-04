import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const grid = 'app/routes/lists+/.$username+/.$list-type+/grid'

/** Every input that carries a row's current position as its value. */
const positionInputs = [
	{ file: `${grid}/position-column.tsx`, value: 'defaultValue={params.value}' },
	{
		file: `${grid}/mobile-watchlist-cards.tsx`,
		value: 'defaultValue={entry.position}',
	},
]

test('a position input selects its value on focus', () => {
	// These inputs carry the row's real position, not a placeholder, so clicking
	// in and typing used to append to the existing number and the user had to
	// clear it first on every edit. Selecting on focus makes typing replace it
	// while the number stays visible and survives a click-away.
	for (const { file, value } of positionInputs) {
		const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
		expect(source, `${file} should still show the current position`).toContain(
			value,
		)
		// The select must belong to the same element that holds the value.
		const start = source.indexOf(value)
		const element = source.slice(Math.max(0, start - 600), start + 600)
		expect(element, `${file} position input must select on focus`).toMatch(
			/onFocus=\{event => event\.currentTarget\.select\(\)\}/,
		)
	}
})

test('the position is not turned into a placeholder', () => {
	// A placeholder would hide the current position, which is information the
	// owner wants to read at a glance, not a hint.
	for (const { file } of positionInputs) {
		const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
		expect(source).not.toMatch(
			/name="(moveRowIndex|position)"[\s\S]{0,300}placeholder=/,
		)
	}
})
