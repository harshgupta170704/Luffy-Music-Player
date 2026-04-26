"""
iTunes Search API client — free, no API key required.
Fetches 30-second preview URLs and high-quality album artwork.
"""
import httpx
from typing import Optional, Tuple

ITUNES_SEARCH = "https://itunes.apple.com/search"


async def fetch_preview(name: str, artist: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (preview_url, artwork_url) for a song.
    preview_url  — 30-second MP3 clip, playable directly in <audio>
    artwork_url  — 600x600 album art JPEG
    Returns (None, None) if not found.
    """
    query = f"{name} {artist}"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(ITUNES_SEARCH, params={
                "term": query,
                "entity": "song",
                "media": "music",
                "limit": 5,
            })
            if r.status_code != 200:
                return None, None

            results = r.json().get("results", [])
            if not results:
                return None, None

            # Best match: prefer exact artist name
            artist_lower = artist.lower()
            best = None
            for track in results:
                if artist_lower in track.get("artistName", "").lower():
                    best = track
                    break
            if not best:
                best = results[0]

            preview_url = best.get("previewUrl")
            art = best.get("artworkUrl100", "")
            # Upgrade to 600x600
            artwork_url = art.replace("100x100bb", "600x600bb") if art else None

            return preview_url, artwork_url

    except Exception:
        return None, None
