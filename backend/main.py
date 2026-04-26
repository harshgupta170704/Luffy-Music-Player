"""
FastAPI backend for the Hybrid Music Recommendation System.

Endpoints:
  GET  /               → serve frontend
  GET  /health         → health check
  GET  /songs          → all songs
  GET  /songs/search   → search songs
  GET  /songs/{id}     → single song
  POST /songs          → add a new song
  GET  /trending       → trending songs
  POST /recommend      → hybrid recommendations
  GET  /personalized   → session-based personalized feed
  POST /interact       → log user interaction
  GET  /engine-status  → current engine weights for a session
  GET  /stats          → global stats
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
import database as db
from hybrid_engine import HybridEngine
from itunes_client import fetch_preview
from youtube_search import search_youtube_id
from models import (
    Song, RecommendRequest, RecommendResponse,
    InteractRequest, AddSongRequest, SearchResponse,
)

# ── App lifecycle ─────────────────────────────────────────────────────────────

engine = HybridEngine()

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    db.migrate_db()   # add any new columns safely
    engine.initialize()
    yield

app = FastAPI(
    title="🎵 Hybrid Music Recommender API",
    description="Content-based + SVD Collaborative hybrid with self-adapting weights",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
FRONTEND = Path(__file__).parent.parent / "frontend"
if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
def health():
    return {"status": "ok", "songs": len(db.get_all_songs())}


# ── Frontend ──────────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
def serve_frontend():
    index = FRONTEND / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"message": "Frontend not found. Place index.html in /frontend/"}


# ── Songs ─────────────────────────────────────────────────────────────────────

@app.get("/songs", response_model=SearchResponse, tags=["Songs"])
def get_songs(genre: str = Query(None), limit: int = Query(80)):
    songs = db.get_all_songs()
    if genre:
        songs = [s for s in songs if s["genre"].lower() == genre.lower()]
    return {"songs": songs[:limit], "total": len(songs)}


@app.get("/songs/search", response_model=SearchResponse, tags=["Songs"])
def search_songs(q: str = Query(..., min_length=1)):
    songs = db.search_songs(q)
    return {"songs": songs, "total": len(songs)}


@app.get("/songs/{song_id}", response_model=Song, tags=["Songs"])
def get_song(song_id: str):
    song = db.get_song_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@app.post("/songs", tags=["Songs"])
def add_song(req: AddSongRequest):
    ok = db.add_song(req.model_dump())
    if not ok:
        raise HTTPException(status_code=400, detail="Could not add song")
    # Trigger refit on next recommendation call
    engine._last_trained = 0.0
    return {"message": "Song added", "id": req.id}


# ── Recommendations ───────────────────────────────────────────────────────────

@app.post("/recommend", response_model=RecommendResponse, tags=["Recommendations"])
def recommend(req: RecommendRequest):
    seed = db.get_song_by_id(req.song_id)
    if not seed:
        raise HTTPException(status_code=404, detail="Seed song not found")

    recs, engine_info = engine.recommend(
        song_id=req.song_id,
        session_id=req.session_id,
        n=req.n,
        mood_filter=req.mood_filter,
    )
    return {
        "seed_song": seed,
        "recommendations": recs,
        "engine_info": engine_info,
    }


@app.get("/personalized", tags=["Recommendations"])
def personalized(session_id: str = Query(...), n: int = Query(10)):
    songs = engine.get_personalized(session_id, n)
    return {"songs": songs, "total": len(songs)}


@app.get("/trending", tags=["Songs"])
def trending(limit: int = Query(10)):
    return {"songs": db.get_trending(limit)}


# ── Interactions ──────────────────────────────────────────────────────────────

@app.post("/interact", tags=["Interactions"])
def interact(req: InteractRequest):
    valid = {"play", "like", "skip", "add_playlist", "remove_playlist", "search_click"}
    if req.interaction_type not in valid:
        raise HTTPException(status_code=400, detail=f"interaction_type must be one of {valid}")
    db.log_interaction(req.session_id, req.song_id, req.interaction_type, req.context)
    weights = db.get_engine_weights(req.session_id)
    return {"ok": True, "engine": weights}


# ── Engine status ─────────────────────────────────────────────────────────────

@app.get("/engine-status", tags=["System"])
def engine_status(session_id: str = Query(...)):
    w = db.get_engine_weights(session_id)
    total = w["total_interactions"]
    mode = "content" if total < 10 else "hybrid" if w["collaborative_weight"] < 0.5 else "collaborative"
    return {**w, "mode": mode, "collab_trained": engine.collab.trained}


# ── YouTube Full Playback ─────────────────────────────────────────────────────

@app.get("/youtube/{song_id}", tags=["Songs"])
async def get_youtube(song_id: str):
    """
    Returns a YouTube video ID for full song playback.
    Searches once via yt-dlp, caches result in DB.
    """
    song = db.get_song_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    # Return cached value
    if song.get("youtube_id"):
        return {"youtube_id": song["youtube_id"]}

    # Search YouTube
    vid_id = await search_youtube_id(song["name"], song["artist"])
    if vid_id:
        db.update_youtube_id(song_id, vid_id)

    return {"youtube_id": vid_id}


# ── Preview (iTunes) ─────────────────────────────────────────────────────────

@app.get("/preview/{song_id}", tags=["Songs"])
async def get_preview(song_id: str):
    """
    Returns 30-second preview URL + album artwork from iTunes.
    Results are cached in the DB so the iTunes API is only called once per song.
    """
    song = db.get_song_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    # Return cached values if already fetched
    if song.get("preview_url") or song.get("album_art"):
        return {
            "preview_url": song.get("preview_url"),
            "album_art": song.get("album_art"),
        }

    # Fetch from iTunes
    preview_url, album_art = await fetch_preview(song["name"], song["artist"])

    # Cache in DB
    db.update_song_preview(song_id, preview_url, album_art)

    return {"preview_url": preview_url, "album_art": album_art}


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/stats", tags=["System"])
def stats():
    return db.get_stats()
