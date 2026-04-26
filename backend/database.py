"""
SQLite persistence layer.
Stores songs, user interactions, engine weights, and stats.
The engine auto-adjusts content vs collaborative weights as interactions grow.
"""
import sqlite3
import pandas as pd
from pathlib import Path
from typing import List, Dict, Tuple, Optional

DB_PATH = Path(__file__).parent / "data" / "music_rec.db"

INTERACTION_WEIGHTS = {
    "play": 1.0,
    "like": 2.0,
    "skip": -0.5,
    "add_playlist": 1.5,
    "remove_playlist": -1.0,
    "search_click": 0.5,
}


def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS songs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            genre TEXT NOT NULL,
            danceability REAL DEFAULT 0,
            energy REAL DEFAULT 0,
            valence REAL DEFAULT 0,
            tempo REAL DEFAULT 0,
            acousticness REAL DEFAULT 0,
            instrumentalness REAL DEFAULT 0,
            liveness REAL DEFAULT 0,
            speechiness REAL DEFAULT 0,
            loudness REAL DEFAULT 0,
            year INTEGER DEFAULT 2020,
            album_art TEXT,
            preview_url TEXT,
            youtube_id TEXT,
            franchise TEXT,
            track_type TEXT,
            season TEXT,
            studio TEXT,
            play_count INTEGER DEFAULT 0,
            like_count INTEGER DEFAULT 0,
            skip_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            song_id TEXT NOT NULL,
            interaction_type TEXT NOT NULL,
            weight REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            context TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_inter_session ON interactions(session_id);
        CREATE INDEX IF NOT EXISTS idx_inter_song ON interactions(song_id);

        CREATE TABLE IF NOT EXISTS engine_weights (
            session_id TEXT PRIMARY KEY,
            content_weight REAL DEFAULT 1.0,
            collaborative_weight REAL DEFAULT 0.0,
            total_interactions INTEGER DEFAULT 0,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()

    # Seed songs from CSV on first run
    count = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
    if count == 0:
        csv_path = Path(__file__).parent / "data" / "songs.csv"
        if csv_path.exists():
            df = pd.read_csv(csv_path)
            df["id"] = df["id"].astype(str)
            for col in ("album_art", "preview_url"):
                df[col] = None
            for col in ("play_count", "like_count", "skip_count"):
                df[col] = 0
            df.to_sql("songs", conn, if_exists="append", index=False)
    conn.commit()
    conn.close()


# ── Song CRUD ────────────────────────────────────────────────────────────────

def get_all_songs() -> List[Dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM songs ORDER BY popularity DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_song_by_id(song_id: str) -> Optional[Dict]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def search_songs(query: str, limit: int = 20) -> List[Dict]:
    conn = get_conn()
    q = f"%{query.lower()}%"
    rows = conn.execute(
        "SELECT * FROM songs WHERE LOWER(name) LIKE ? OR LOWER(artist) LIKE ? OR LOWER(genre) LIKE ? LIMIT ?",
        (q, q, q, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_song(data: Dict) -> bool:
    conn = get_conn()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO songs
               (id,name,artist,album,genre,danceability,energy,valence,tempo,
                acousticness,instrumentalness,liveness,speechiness,loudness,
                popularity,year,album_art,preview_url,play_count,like_count,skip_count)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0)""",
            (
                str(data["id"]), data["name"], data["artist"], data["album"], data["genre"],
                data.get("danceability", 0.5), data.get("energy", 0.5), data.get("valence", 0.5),
                data.get("tempo", 120), data.get("acousticness", 0.1), data.get("instrumentalness", 0),
                data.get("liveness", 0.1), data.get("speechiness", 0.05), data.get("loudness", -7),
                data.get("popularity", 50), data.get("year", 2024),
                data.get("album_art"), data.get("preview_url"),
            ),
        )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()


def update_song_preview(song_id: str, preview_url: Optional[str], album_art: Optional[str]):
    conn = get_conn()
    conn.execute(
        "UPDATE songs SET preview_url = ?, album_art = ? WHERE id = ?",
        (preview_url, album_art, song_id),
    )
    conn.commit()
    conn.close()


def update_youtube_id(song_id: str, youtube_id: str):
    conn = get_conn()
    conn.execute("UPDATE songs SET youtube_id = ? WHERE id = ?", (youtube_id, song_id))
    conn.commit()
    conn.close()
    # Also add column if it doesn't exist (migration safety)


def migrate_db():
    """Add any missing columns for forward compatibility."""
    conn = get_conn()
    for col in ["youtube_id", "franchise", "track_type", "season", "studio"]:
        try:
            conn.execute(f"ALTER TABLE songs ADD COLUMN {col} TEXT")
            conn.commit()
        except Exception:
            pass  # Column already exists
    conn.close()


def get_trending(limit: int = 10) -> List[Dict]:
    conn = get_conn()
    rows = conn.execute(
        """SELECT *, (play_count * 1.0 + like_count * 2.0 - skip_count * 0.5) AS trend_score
           FROM songs ORDER BY trend_score DESC, popularity DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Interactions ──────────────────────────────────────────────────────────────

def log_interaction(session_id: str, song_id: str, itype: str, context: str = None):
    weight = INTERACTION_WEIGHTS.get(itype, 0.5)
    conn = get_conn()
    conn.execute(
        "INSERT INTO interactions (session_id, song_id, interaction_type, weight, context) VALUES (?,?,?,?,?)",
        (session_id, song_id, itype, weight, context),
    )
    if itype == "play":
        conn.execute("UPDATE songs SET play_count = play_count + 1 WHERE id = ?", (song_id,))
    elif itype == "like":
        conn.execute("UPDATE songs SET like_count = like_count + 1 WHERE id = ?", (song_id,))
    elif itype == "skip":
        conn.execute("UPDATE songs SET skip_count = skip_count + 1 WHERE id = ?", (song_id,))
    conn.commit()
    conn.close()
    _update_weights(session_id)


def _update_weights(session_id: str):
    conn = get_conn()
    total = conn.execute(
        "SELECT COUNT(*) FROM interactions WHERE session_id = ? AND weight > 0", (session_id,)
    ).fetchone()[0]

    if total < 10:
        cw, colw = 1.0, 0.0
    elif total < 30:
        colw = (total - 10) / 20.0 * 0.4
        cw = 1.0 - colw
    elif total < 60:
        colw = 0.4 + (total - 30) / 30.0 * 0.2
        cw = 1.0 - colw
    else:
        cw, colw = 0.4, 0.6

    conn.execute(
        """INSERT INTO engine_weights (session_id, content_weight, collaborative_weight, total_interactions)
           VALUES (?,?,?,?)
           ON CONFLICT(session_id) DO UPDATE SET
               content_weight=excluded.content_weight,
               collaborative_weight=excluded.collaborative_weight,
               total_interactions=excluded.total_interactions,
               last_updated=CURRENT_TIMESTAMP""",
        (session_id, cw, colw, total),
    )
    conn.commit()
    conn.close()


def get_engine_weights(session_id: str) -> Dict:
    conn = get_conn()
    row = conn.execute("SELECT * FROM engine_weights WHERE session_id = ?", (session_id,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return {"session_id": session_id, "content_weight": 1.0, "collaborative_weight": 0.0, "total_interactions": 0}


def get_user_song_scores(session_id: str) -> Dict[str, float]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT song_id, SUM(weight) AS score FROM interactions WHERE session_id = ? GROUP BY song_id",
        (session_id,),
    ).fetchall()
    conn.close()
    return {r["song_id"]: r["score"] for r in rows}


def get_all_interactions() -> List[Tuple]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT session_id, song_id, SUM(weight) AS score FROM interactions GROUP BY session_id, song_id"
    ).fetchall()
    conn.close()
    return [(r["session_id"], r["song_id"], r["score"]) for r in rows]


def get_stats() -> Dict:
    conn = get_conn()
    stats = {
        "total_songs": conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0],
        "total_interactions": conn.execute("SELECT COUNT(*) FROM interactions").fetchone()[0],
        "total_sessions": conn.execute("SELECT COUNT(DISTINCT session_id) FROM interactions").fetchone()[0],
        "most_played": [dict(r) for r in conn.execute(
            "SELECT name, artist, play_count FROM songs ORDER BY play_count DESC LIMIT 5"
        ).fetchall()],
        "most_liked": [dict(r) for r in conn.execute(
            "SELECT name, artist, like_count FROM songs ORDER BY like_count DESC LIMIT 5"
        ).fetchall()],
    }
    conn.close()
    return stats
