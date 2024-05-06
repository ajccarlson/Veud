import "#app/styles/home.scss"
import { TrendingData } from '#app/routes/_home+/_trending.jsx'

export default function Index() {
  return (
    <main class="home">
      <div class="home-main">
        {TrendingData()}
      </div>
    </main>
  )
}
