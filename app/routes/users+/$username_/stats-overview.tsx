import {
	type ProfileAnalyticsData,
	type ProfileShellData,
} from '#app/utils/profile.ts'

function progressLabel(unit: string) {
  const plural = `${unit.charAt(0).toUpperCase()}${unit.slice(1)}s`
  if (unit === 'chapter' || unit === 'volume') return `${plural} Read`
  if (unit === 'episode') return 'Episodes Watched'
  return `${plural} Tracked`
}

export function StatsOverview({
	data,
}: {
	data: Pick<ProfileShellData, 'listTypes'> & ProfileAnalyticsData
}) {
  const { listTypes, trackingSummaries } = data

  return (
    <div className="user-landing-stats-overview">
      {listTypes.map(type => {
        const summary = trackingSummaries[type.id] ?? {
          totalTitles: 0,
          meanScore: null,
          repeatCount: 0,
          progress: [],
          statuses: [],
        }

        return (
          <div className="user-landing-stats-overview-card" key={type.id}>
            <h2 className="user-landing-stats-overview-title">{type.header}</h2>
            <div className="user-landing-stats-overview-figures">
              <div className="user-landing-stats-overview-figure">
                <span className="user-landing-stats-overview-value">
                  {summary.meanScore != null ? summary.meanScore.toFixed(2) : '—'}
                </span>
                <span className="user-landing-stats-overview-label">Mean Score</span>
              </div>
              <div className="user-landing-stats-overview-figure">
                <span className="user-landing-stats-overview-value">{summary.totalTitles}</span>
                <span className="user-landing-stats-overview-label">Total Titles</span>
              </div>
              {summary.progress.map(progress => (
                <div className="user-landing-stats-overview-figure" key={progress.unit}>
                  <span className="user-landing-stats-overview-value">{progress.current}</span>
                  <span className="user-landing-stats-overview-label">
                    {progressLabel(progress.unit)}
                  </span>
                </div>
              ))}
              {summary.repeatCount > 0 ? (
                <div className="user-landing-stats-overview-figure">
                  <span className="user-landing-stats-overview-value">{summary.repeatCount}</span>
                  <span className="user-landing-stats-overview-label">Repeats</span>
                </div>
              ) : null}
            </div>
            <ul className="user-landing-stats-overview-statuses">
              {summary.statuses.map(status => (
                <li className="user-landing-stats-overview-status" key={status.key}>
                  <span className="user-landing-stats-overview-status-label">
                    {status.label}
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
