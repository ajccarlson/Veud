import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'

export function UpcomingData(params) {
  let upcomingEpisodes = {}

  Object.entries(params.userTypedEntries).forEach(([typedEntryKey, typedEntryValue]) => {
    let upcomingType = ""
    if (typedEntryKey == "yducsgix") {
      upcomingType = "nextEpisode"
    }
    else if (typedEntryKey == "lx727mrc") {
      upcomingType = "airInfo"
    }
    else if (typedEntryKey == "b44evg7f") {
      upcomingType = "publishInfo"
    }

    typedEntryValue.forEach(listEntry => {
      if (listEntry[upcomingType]) {
        const parsedNext = JSON.parse(listEntry[upcomingType])

        if (upcomingType == "nextEpisode" && parsedNext.airDate) {
          upcomingEpisodes[parsedNext.airDate] = parsedNext
        }
        else if (upcomingType == "airInfo" && parsedNext.day) {
          console.log(listEntry)
          upcomingEpisodes[parsedNext.airDate] = parsedNext
        }
      }
    })
  })

  console.log(upcomingEpisodes)

  return null
}