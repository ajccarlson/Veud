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

export function TrendingData() {
  const [trendingMovies, setTrendingMovies] = useState()
  const [trendingTV, setTrendingTV] = useState()
  const [seasonalAnime, setSeasonalAnime] = useState()
  const [trendingItems, setTrendingItems] = useState(setTrending({trendingMovies, trendingTV}))

  useEffect(() => {
    if (!trendingMovies || trendingMovies.length < 1) {
      getTrending("tmdb", {mediaType: "movie", numResults: 10}).then(val => {
        setTrendingMovies(val)
      }).catch(e => {
        console.log(e)
      })
    }
  }, [trendingMovies])

  useEffect(() => {
    if (!trendingTV || trendingTV.length < 1) {
      getTrending("tmdb", {mediaType: "tv", numResults: 10}).then(val => {
        setTrendingTV(val)
      }).catch(e => {
        console.log(e)
      })
    }
  }, [trendingTV])

  useEffect(() => {
    if (!seasonalAnime || seasonalAnime.length < 1) {
      const date = new Date()
      getTrending("mal", {year: date.getFullYear(), month: date.getMonth(), numResults: 10}).then(val => {
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
        {Object.entries(trendingItems).map(([trendingKey, trendingValue]) => {
          return (
            <div class="trending-item-container">
              <h1 class="trending-item-header">{trendingValue.header}</h1>
              <div class="trending-nav-thumbnail-container">
                {trendingValue.data?.length > 1 ?
                  trendingValue.data.map(trendingItem => {
                    return (
                      <div class="trending-nav-thumbnail-item">
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
                  })
                :
                  null
                }
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}