import { expect, test } from 'vitest'
import { parsePm2JsonList } from './preflight-production.mjs'

const banner = [
	'>>>> In-memory PM2 is out-of-date, do:',
	'>>>> $ pm2 update',
	'In memory PM2 version: 6.0.8',
	'Local PM2 version: 7.0.3',
	'',
].join('\n')

test('the version-skew banner does not stop the check running', () => {
	// A failed parse downgraded this check from verifying which launcher PM2
	// runs to printing a note — and that check exists because production once
	// ran from the working tree instead of the release.
	const list = [{ name: 'veud', pm2_env: { status: 'online' } }]
	expect(parsePm2JsonList(banner + JSON.stringify(list))).toEqual(list)
	expect(parsePm2JsonList(JSON.stringify(list))).toEqual(list)
})

test('output with no array in it is a failure, not an empty list', () => {
	// Reporting "no processes" when pm2 said something unparseable would let a
	// missing process look like a passing check.
	expect(parsePm2JsonList('>>>> pm2 daemon not running')).toBeNull()
	expect(parsePm2JsonList('')).toBeNull()
	expect(parsePm2JsonList(undefined)).toBeNull()
	expect(parsePm2JsonList('{"name":"veud"}')).toBeNull()
})

test('a truncated array is a failure rather than a partial answer', () => {
	expect(parsePm2JsonList(`${banner}[{"name":"veud"`)).toBeNull()
})
