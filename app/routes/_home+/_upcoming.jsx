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
          upcomingEpisodes[new Date(parsedNext.airDate)] = parsedNext
        }
        else if (upcomingType == "airInfo" && parsedNext.day && !listEntry.releaseEnd) {
          let date = new Date()
          date.setDate(date.getDate() + (4 + 7 - date.getDay()) % 7)

          // const rawTime = parsedNext.time
          // const timeMilli = Number(rawTime.split(':')[0]) * 60 * 60 * 1000 + Number(rawTime.split(':')[1]) * 60 * 1000
          // const broadCastDateTime = new Date(date + timeMilli)

          upcomingEpisodes[date] = parsedNext
        }
      }
    })
  })

  return null
}