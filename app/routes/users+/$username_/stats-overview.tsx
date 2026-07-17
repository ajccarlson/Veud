import { type ProfileData } from '#app/utils/profile.ts'

/** Mean of the personal scores across entries, ignoring unscored (null / 0). */
function meanScore(entries: any[]): number | null {
  const scored = entries
    .map(entry => (entry?.personal != null ? parseFloat(String(entry.personal)) : NaN))
    .filter(value => !Number.isNaN(value) && value > 0)
  if (scored.length === 0) return null
  return scored.reduce((sum, value) => sum + value, 0) / scored.length
}

export function StatsOverview({ data }: { data: ProfileData }) {
  const { listTypes, typedEntries, watchLists } = data

  return (
    <div className="user-landing-stats-overview">
      {listTypes.map(type => {
        const entries = typedEntries[type.id] ?? []
        const total = entries.length
        const mean = meanScore(entries)

        // Status breakdown: this type's watchlists, in order, each with its entry count.
        const statuses = watchLists
          .filter(watchlist => watchlist.typeId === type.id)
          .slice()
          .sort((a, b) => a.position - b.position)
          .map(watchlist => ({
            header: watchlist.header,
            count: entries.filter(entry => entry?.watchlistId === watchlist.id).length,
          }))

        return (
          <div className="user-landing-stats-overview-card" key={type.id}>
            <h2 className="user-landing-stats-overview-title">{type.header}</h2>
            <div className="user-landing-stats-overview-figures">
              <div className="user-landing-stats-overview-figure">
                <span className="user-landing-stats-overview-value">
                  {mean != null ? mean.toFixed(2) : '—'}
                </span>
                <span className="user-landing-stats-overview-label">Mean Score</span>
              </div>
              <div className="user-landing-stats-overview-figure">
                <span className="user-landing-stats-overview-value">{total}</span>
                <span className="user-landing-stats-overview-label">Total Entries</span>
              </div>
            </div>
            <ul className="user-landing-stats-overview-statuses">
              {statuses.map(status => (
                <li className="user-landing-stats-overview-status" key={status.header}>
                  <span className="user-landing-stats-overview-status-label">
                    {status.header}
                  </span>
                  <span className="user-landing-stats-overview-status-count">
                    {status.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
