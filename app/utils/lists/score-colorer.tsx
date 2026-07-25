type ScoreColorStop = {
	value: number
	red: number
	green: number
	blue: number
}

type ScoreColorRange = {
	min: ScoreColorStop
	max: ScoreColorStop
}

type ScoreColorInput = {
	range: ScoreColorRange
	score: number
	type: string
}

export function scoreRange(rangeType?: string): ScoreColorRange {
	if (rangeType === 'Difference Personal') {
		return {
			min: { value: -3, red: 128, green: 64, blue: 109 },
			max: { value: 3, red: 64, green: 73, blue: 128 },
		}
	}
	if (rangeType === 'TMDB Score') {
		return {
			min: { value: 1, red: 0, green: 0, blue: 0 },
			max: { value: 10, red: 177, green: 182, blue: 212 },
		}
	}
	if (rangeType === 'Difference Objective') {
		return {
			min: { value: -3, red: 128, green: 64, blue: 68 },
			max: { value: 3, red: 64, green: 106, blue: 128 },
		}
	}
	return {
		min: { value: 1, red: 0, green: 0, blue: 0 },
		max: { value: 10, red: 96, green: 64, blue: 128 },
	}
}

function colorRatio({
	range,
	score,
	type,
}: ScoreColorInput): Pick<ScoreColorStop, 'red' | 'green' | 'blue'> {
	let {
		value: minValue,
		red: minRed,
		green: minGreen,
		blue: minBlue,
	} = range.min
	let {
		value: maxValue,
		red: maxRed,
		green: maxGreen,
		blue: maxBlue,
	} = range.max
	let curveValue = 0.01

	if (type !== 'Default') {
		if (type === 'TMDB Score' || type === 'MAL Score') {
			curveValue = 0.1
		} else if (score > 0) {
			minValue = 0
			curveValue = -0.05
			minRed = 0
			minGreen = 0
			minBlue = 0
		} else if (score < 0) {
			maxValue = 0
			curveValue = 0.1
			maxRed = 0
			maxGreen = 0
			maxBlue = 0
		}
	}

	const perfectRatio = (score - minValue) / (maxValue - minValue)
	const curvedRatio = Math.min(
		1,
		Math.max(0, perfectRatio - (maxValue - score) * curveValue),
	)
	return {
		red: (maxRed - minRed) * curvedRatio + minRed,
		green: (maxGreen - minGreen) * curvedRatio + minGreen,
		blue: (maxBlue - minBlue) * curvedRatio + minBlue,
	}
}

export function scoreColor(scoreParams: ScoreColorInput) {
	if (!Number.isFinite(scoreParams.score) || scoreParams.score === 0) {
		return undefined
	}
	const ratio = colorRatio(scoreParams)
	return {
		backgroundColor: `rgb(${ratio.red}, ${ratio.green}, ${ratio.blue})`,
	}
}
