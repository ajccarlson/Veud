import { WatchList } from "#app/routes/lists+/lists.$watchlist.jsx";
import "#app/styles/list-landing.css";

export default function Index() {
  return (
    <main style={{ width: '100%', height: '100%' }}>
      <WatchList/>
      <div class="flex flex-row gap-4 justify-center bg-[#464646]">
        <button class="bg-[#6F6F6F] hover:bg-[#BF8630] text-white font-bold py-5 px-10 border-b-4 border-[#FFD700] hover:border-[#FFF800] rounded">01</button>
        <button class="bg-[#6F6F6F] hover:bg-[#BF8630] text-white font-bold py-5 px-10 border-b-4 border-[#FFD700] hover:border-[#FFF800] rounded">02</button>
        <button class="bg-[#6F6F6F] hover:bg-[#BF8630] text-white font-bold py-5 px-10 border-b-4 border-[#FFD700] hover:border-[#FFF800] rounded">03</button>
      </div>
    </main>
  )
}