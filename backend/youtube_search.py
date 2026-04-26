"""YouTube video ID search using yt-dlp (no API key needed)."""
import asyncio
import yt_dlp


async def search_youtube_id(name: str, artist: str) -> str | None:
    query = f"{name} {artist} anime full"
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _search, query)
    except Exception as e:
        print(f"[YT] {e}")
        return None


def _search(query: str) -> str | None:
    opts = {
        "quiet": True, "no_warnings": True,
        "extract_flat": True, "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch1:{query}", download=False)
        entries = (info or {}).get("entries", [])
        return entries[0].get("id") if entries else None
