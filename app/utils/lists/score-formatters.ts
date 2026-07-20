function finiteNumber(value: unknown) {
	if (
		value === null ||
		value === undefined ||
		value === '' ||
		(typeof value === 'string' && value.trim().toLowerCase() === 'null')
	) {
		return null
	}

	const number = Number(value)
	return Number.isFinite(number) ? number : null
}

export function providedScore(value: unknown) {
	const score = finiteNumber(value)
	return score === null || score === 0 ? null : score
}

export function formatScore(value: unknown, fractionDigits?: number) {
	const score = providedScore(value)
	if (score === null) return ''
	return fractionDigits === undefined
		? String(score)
		: score.toFixed(fractionDigits)
}

export function averageScores(values: unknown[]) {
	const scores = values
		.map(providedScore)
		.filter((score): score is number => score !== null)
	if (!scores.length) return null
	return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

export function scoreDifference(left: unknown, right: unknown) {
	const leftScore = providedScore(left)
	const rightScore = providedScore(right)
	if (leftScore === null || rightScore === null) return null
	return leftScore - rightScore
}

export function formatDifference(value: unknown) {
	const difference = finiteNumber(value)
	if (difference === null) return ''
	return `${difference > 0 ? '+' : ''}${difference.toFixed(2)}`
}
