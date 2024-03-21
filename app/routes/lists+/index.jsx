import { WatchList } from "#app/routes/lists+/lists.$watchlist.jsx";
import "#app/styles/list-landing.css";

export default function Index() {
  return (
    <main style={{ width: '100%', height: '100%' }}>
      <WatchList/>
      <div class="Row" style={{ height: '10%' }}>
          <div class="Column">C1</div>
          <div class="Column">C2</div>
          <div class="Column">C3</div>
      </div>
    </main>
  )
}