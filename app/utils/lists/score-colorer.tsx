interface scoreObject {
    range: {
        min: {
            value: number,
            red: number,
            green: number,
            blue: number
        };
        max: {
            value: number,
            red: number,
            green: number,
            blue: number
        },
    }
    score: number,
    type: string
}

export function scoreRange(rangeType: string) {
    if (rangeType == "Difference Personal") {
        return {
            min: {
                value: -3,
                red: 128,
                green: 64,
                blue: 109
            },
            max: {
                value: 3,
                red: 64,
                green: 73,
                blue: 128
            }
        }
    }
    else if (rangeType == "TMDB Score") {
        return {
            min: {
                value: 1,
                red: 0,
                green: 0,
                blue: 0
            },
            max: {
                value: 10,
                red: 177,
                green: 182,
                blue: 212
            }
        }
    }
    else if (rangeType == "Difference Objective") {
        return {
            min: {
                value: -3,
                red: 128,
                green: 64,
                blue: 68
            },
            max: {
                value: 3,
                red: 64,
                green: 106,
                blue: 128
            }
        }
    }
    else {
        return {
            min: {
                value: 1,
                red: 0,
                green: 0,
                blue: 0
            },
            max: {
                value: 10,
                red: 96,
                green: 64,
                blue: 128
            }
        }
    }
}

function colorRatio(scoreParams: scoreObject) {
    let minValue: number = scoreParams['range']['min']['value']
    let maxValue: number = scoreParams['range']['max']['value']

    let minRed: number = scoreParams['range']['min']['red']
    let maxRed: number = scoreParams['range']['max']['red']

    let minGreen: number = scoreParams['range']['min']['green']
    let maxGreen: number = scoreParams['range']['max']['green']

    let minBlue: number = scoreParams['range']['min']['blue']
    let maxBlue: number = scoreParams['range']['max']['blue']

    let curveValue: number = 0.01

    if (scoreParams['type'] != "Default") {
        if (scoreParams['type'] == "TMDB Score") {
            curveValue = 0.1
        } else if (scoreParams['score'] > 0) {
            minValue = 0;
            curveValue = -0.05
            minRed = 0;
            minGreen = 0;
            minBlue = 0;
        } else if (scoreParams['score'] < 0) {
            maxValue = 0;
            curveValue = 0.1
            maxRed = 0;
            maxGreen = 0;
            maxBlue = 0;
        }
    }

    let perfectRatio: number = (scoreParams['score'] - minValue) / (maxValue - minValue)
    let perfectDistance: number = maxValue - scoreParams['score']
    let curvedRatio: number = perfectRatio - (perfectDistance * curveValue)

    let redDifference: number = maxRed - minRed
    let greenDifference: number = maxGreen - minGreen
    let blueDifference: number = maxBlue - minBlue
    
    return {
        red: (redDifference * curvedRatio + minRed),
        green: (greenDifference * curvedRatio + minGreen),
        blue: (blueDifference * curvedRatio + minBlue),
    }
}

export function scoreColor(scoreParams: scoreObject) {
    if (!scoreParams.score || scoreParams.score == 0)
      return;

    let ratio = {} as any;
    ratio = colorRatio(scoreParams);
    
    const color = "rgb(" + ratio['red'] + ", " + ratio['green'] + ", " + ratio['blue'] + ")"
    return {
      backgroundColor: color,
    };
}
