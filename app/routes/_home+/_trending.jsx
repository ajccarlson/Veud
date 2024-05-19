import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { getSeasonalAnime } from "#app/routes/media+/mal.jsx"
import { getTMDBTrending } from "#app/routes/media+/tmdb.jsx"
import { getThumbnailInfo } from "#app/utils/lists/column-functions.jsx"

async function getTrending(site, trendingParams) {
  if (site == "tmdb") {
    return await getTMDBTrending(trendingParams.mediaType, trendingParams.numResults)
  }
  else if (site == "mal") {
    return await getSeasonalAnime(trendingParams.year, trendingParams.month, trendingParams.numResults)
  }
}

function setTrending(trendingParams) {
  return {
    trendingMovie: {
      header: "Trending Movies",
      data: trendingParams.trendingMovies,
    },
    trendingTV: {
      header: "Trending TV",
      data: trendingParams.trendingTV,
    },
    seasonalAnime: {
      header: "Airing Anime",
      data: trendingParams.seasonalAnime,
    }
  }
}

export function TrendingData(currentUser) {
  const [trendingMovies, setTrendingMovies] = useState()
  const [trendingTV, setTrendingTV] = useState()
  const [seasonalAnime, setSeasonalAnime] = useState()
  const [trendingItems, setTrendingItems] = useState(setTrending({trendingMovies, trendingTV, seasonalAnime}))
  
  const thumbnailArray = ["https://image.tmdb.org/t/p/original/ksBffAuz4xzquWCTCjlG2kAEZ7P.jpg", "https://image.tmdb.org/t/p/original/7L9MgdBPMMCnkcKN2nAD862g0qN.jpg", "https://image.tmdb.org/t/p/original/2y6jZRoM6arYpNXC2GZAjUV4bmW.jpg", "https://image.tmdb.org/t/p/original/VZbAdOpwUX6wqyYQAAFS9YKgKS.jpg", "https://image.tmdb.org/t/p/original/5uZyubyIqpGfnOg3Zj87pf5Khm6.jpg", "https://image.tmdb.org/t/p/original/hNBNhNd6fnvsFdDwKz6mh890jaZ.jpg", "https://image.tmdb.org/t/p/original/jd13Sq0pdl81F90p2pQAbBI3NZk.jpg", "https://image.tmdb.org/t/p/original/31yHdUtoooGcslDcJsPzxP5sEWM.jpg", "https://image.tmdb.org/t/p/original/wHNwlE6ftEpgjVbdhLXOtv1hLs0.jpg", "https://image.tmdb.org/t/p/original/2meX1nMdScFOoV4370rqHWKmXhY.jpg", "https://image.tmdb.org/t/p/original/d87JXX3DLkRJMfm5StCmmnmhHuX.jpg", "https://image.tmdb.org/t/p/original/8BcQ49alz5CQABR0oiBKpQtQSro.jpg", "https://image.tmdb.org/t/p/original/lvSB0bnLzuxwrfTlI2l13gctWRn.jpg", "https://image.tmdb.org/t/p/original/5SXCdStomTouV3487vCSkDPEBHr.jpg", "https://image.tmdb.org/t/p/original/wQEW3xLrQAThu1GvqpsKQyejrYS.jpg", "https://image.tmdb.org/t/p/original/q8eejQcg1bAqImEV8jh8RtBD4uH.jpg", "https://image.tmdb.org/t/p/original/1b0thlqquLMGrjHcxFVWSaZtTLC.jpg", "https://image.tmdb.org/t/p/original/pbrkL804c8yAv3zBZR4QPEafpAR.jpg", "https://image.tmdb.org/t/p/original/65BTgbR7w8g5h8PlNwUgRVWqPyQ.jpg", "https://image.tmdb.org/t/p/original/1Ld1OTmrocP7h5px8k16ymaxIvS.jpg", "https://image.tmdb.org/t/p/original/hiKmpZMGZsrkA3cdce8a7Dpos1j.jpg", "https://image.tmdb.org/t/p/original/qU4HDNKv7gjdlvMu74r70rISPwn.jpg", "https://image.tmdb.org/t/p/original/sPaUE06Zu99aEr4uTFNnK8ZV9pD.jpg", "https://image.tmdb.org/t/p/original/fTdBMqmlfQ7ZeiLkvHyh14Bx8a3.jpg", "https://image.tmdb.org/t/p/original/vAp1u1TVufGRzmNsqtVuZhdHUFY.jpg", "https://image.tmdb.org/t/p/original/8WMuefemyvvJxoZoZ62L06rDGtM.jpg", "https://image.tmdb.org/t/p/original/wdUghFTcbuIqM49qdfamSewbRle.jpg", "https://image.tmdb.org/t/p/original/xcDiiWTFJ6T3D3qayL1DdlDeQz8.jpg", "https://image.tmdb.org/t/p/original/yodnsKfTUbcxemzTx1hb5rkVJeU.jpg", "https://image.tmdb.org/t/p/original/dvl0XE1A6JBYlV72E2HVGZsYiK9.jpg", "https://image.tmdb.org/t/p/original/nfWhNM5VVd9a5bEGobs83TWTuLM.jpg", "https://image.tmdb.org/t/p/original/aYD6bR1xs9OAK3lA5WHbvIX2gMN.jpg", "https://image.tmdb.org/t/p/original/fK0KYp0lgixgUhSPuT9HCqS6Yy.jpg", "https://image.tmdb.org/t/p/original/uEoaOfvWibpvjBNxFoj4MxWn0OH.jpg", "https://image.tmdb.org/t/p/original/mpUcBHfzKpSo72rwo2EaaGkeSX1.jpg", "https://image.tmdb.org/t/p/original/iETN9WbG94gYbzpqftwtpQvhCiD.jpg", "https://image.tmdb.org/t/p/original/nzE6hIvfVOnPNAdX83OKy0yNGMa.jpg", "https://image.tmdb.org/t/p/original/jCp38EnWH2MEDgYPrujBC13dMOy.jpg", "https://image.tmdb.org/t/p/original/zH9VWcgBCQaGjeR8c1C4UtuOwWd.jpg", "https://image.tmdb.org/t/p/original/uqTCaYBoSLT9MAdyQ9tU6QyCZ3A.jpg", "https://image.tmdb.org/t/p/original/dK1DD0M7vm9rJAqKVLlXrn6dswN.jpg", "https://image.tmdb.org/t/p/original/7VMPXWo1KpeMiefk6Dpf4Odhs8w.jpg", "https://image.tmdb.org/t/p/original/ohNzyaaRJ3gyunuPwzFqwlfnZJp.jpg", "https://image.tmdb.org/t/p/original/twA0XYggQKwNaDQlTZvvdPec3p8.jpg", "https://image.tmdb.org/t/p/original/3K7VJW9dVx9PfgulZiYLJZafBYU.jpg", "https://image.tmdb.org/t/p/original/zZqpAXxVSBtxV9qPBcscfXBcL2w.jpg", "https://image.tmdb.org/t/p/original/95mqtO1ZHvtnsqoMXAqBk8EjuRu.jpg", "https://image.tmdb.org/t/p/original/djhEQvGsv7o3qf8fLQc1p6KHEy1.jpg", "https://image.tmdb.org/t/p/original/pYEFwZj6YDR8OhX9tyO78IoJADe.jpg", "https://image.tmdb.org/t/p/original/5N0cTcBq57e4yhARt6dOmrupvAT.jpg", "https://image.tmdb.org/t/p/original/26KFG5GQ6PfCRaeURFs2T339eXJ.jpg", "https://image.tmdb.org/t/p/original/szxo4pzatit94Avn0aqyLJhwIVR.jpg", "https://image.tmdb.org/t/p/original/cmyZfAGmtiYtKNwuXjmRn3fXRQA.jpg", "https://image.tmdb.org/t/p/original/wYG0n3F8fPPm3Uz87Ru7DafFiT7.jpg", "https://image.tmdb.org/t/p/original/xOpQ4jIQJ0HSUhVDixZA9yWqVBP.jpg", "https://image.tmdb.org/t/p/original/4lr2VqOcw9YROMnOWoHtUR9xGxA.jpg", "https://image.tmdb.org/t/p/original/zMHyNxNt4zhL939XX8QLBW3gWfu.jpg", "https://image.tmdb.org/t/p/original/pB3t7qGaN89trJzNNBTyGKYzh2.jpg", "https://image.tmdb.org/t/p/original/hzW2kxEXGkciDc5tB20AbcysnUu.jpg", "https://image.tmdb.org/t/p/original/dORCOeripNHI7l1TEayBrsUhWoM.jpg", "https://image.tmdb.org/t/p/original/nIcWLH8IWz6CfkD5KXF37QL2dR9.jpg", "https://image.tmdb.org/t/p/original/d7JUXVvjvVCXWs1mlpyO5ESdWdT.jpg", "https://image.tmdb.org/t/p/original/dK1JoC1OgXly6RcgiedkHlyYNy1.jpg"]

  const [chosenThumbnail, setChosenThumbnail] = useState(Math.floor(Math.random() * thumbnailArray.length))

  useEffect(() => {
    if (!trendingMovies || trendingMovies.length < 1) {
      getTrending("tmdb", {mediaType: "movie", numResults: 50}).then(val => {
        setTrendingMovies(val)
      }).catch(e => {
        console.log(e)
      })
    }
  }, [trendingMovies])

  useEffect(() => {
    if (!trendingTV || trendingTV.length < 1) {
      getTrending("tmdb", {mediaType: "tv", numResults: 50}).then(val => {
        setTrendingTV(val)
      }).catch(e => {
        console.log(e)
      })
    }
  }, [trendingTV])

  useEffect(() => {
    if (!seasonalAnime || seasonalAnime.length < 1) {
      const date = new Date()
      getTrending("mal", {year: date.getFullYear(), month: date.getMonth(), numResults: 50}).then(val => {
        setSeasonalAnime(val)
      }).catch(e => {
        console.log(e)
      })
    }
  }, [seasonalAnime])

  useEffect(() => {
    setTrendingItems(setTrending({trendingMovies, trendingTV, seasonalAnime}))
  }, [trendingMovies, trendingTV, seasonalAnime])

  return (
    <div class="trending-main">
      <div class="trending-container">
        {currentUser ? 
          <div class="home-signup-container">
            <h1 class="home-signup-header">Join Today</h1>
            <div class="home-signup-items" style={{backgroundImage: `linear-gradient(rgba(27, 23, 30, 0.7), rgba(27, 23, 30, 0.7)), url("${thumbnailArray[chosenThumbnail]}")`}}>
              <div class="home-signup-message">
                Gain access to manage your own personalized lists, keep track of your viewing history, and effortlessly discover your next watch.
              </div>
            </div>
            <Link to={'/signup'} class="home-signup-button">
                Sign Up
              </Link>
          </div>
        :
          null
        }
        {Object.entries(trendingItems).map(([trendingKey, trendingValue]) => {
          return (
            trendingValue.data?.length > 1 ?
              <div class="trending-item-container">
                <h1 class="trending-item-header animate-slide-top [animation-fill-mode:backwards] ">{trendingValue.header}</h1>
                <div class="trending-nav-thumbnail-container">
                  {trendingValue.data.slice(0, 10).map((trendingItem, index) => {
                    return (
                      <div class="trending-nav-thumbnail-item animate-roll-reveal [animation-fill-mode:backwards]" style={{ animationDelay: `${index * 0.07}s` }}>
                        <Link to={getThumbnailInfo(trendingItem.thumbnail).url} className="trending-body-thumbnail-image" style={{backgroundImage: `url("${getThumbnailInfo(trendingItem.thumbnail).content}")`}}>
                          {/* <span className="trending-thumbnail-header">
                            <div className="trending-thumbnail-start-year">
                              {trendingItem.year}
                            </div>
                          </span> */}
                          <span className="trending-thumbnail-footer">
                            {trendingItem.title.length > 20 ? `${trendingItem.title.substring(0, 20)}...` : trendingItem.title}
                          </span>
                        </Link>
                      </div>
                    )
                  })}
                </div>
              </div>
            :
            <div class="trending-loader-main">
              <div class="trending-loader-container">
                <div class="trending-loader-item trending-loader-item-1"></div>
                <div class="trending-loader-item trending-loader-item-2"></div>
                <div class="trending-loader-item trending-loader-item-3"></div>
                <div class="trending-loader-item trending-loader-item-4"></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}