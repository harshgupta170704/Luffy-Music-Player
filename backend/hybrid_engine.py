"""
Hybrid Recommendation Engine.

Strategy:
  1. Content-based (cosine sim on audio features) — always available
  2. SVD Collaborative Filtering — activates as interactions grow
  3. Hybrid score = content_weight * content_score + collab_weight * collab_score
  4. Ranking boosts: popularity, recency; diversity penalty: same artist
  5. Weights auto-adapt per session stored in SQLite

Engine modes (based on interaction count per session):
  < 10  → Pure content  (cold start)
  10-30 → Hybrid 80/20 → 60/40
  30-60 → Hybrid 60/40 → 40/60
  > 60  → Collaborative dominant 40/60
"""
import time
import threading
import numpy as np
from typing import Dict, List, Optional, Tuple
import database as db
from content_based import ContentBasedRecommender
from collaborative import CollaborativeRecommender


class HybridEngine:
    RETRAIN_INTERVAL = 30  # seconds

    def __init__(self):
        self.content = ContentBasedRecommender()
        self.collab = CollaborativeRecommender(n_factors=20)
        self._lock = threading.Lock()
        self._last_trained = 0.0
        self._retraining = False

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def initialize(self):
        songs = db.get_all_songs()
        if songs:
            self.content.fit(songs)
        interactions = db.get_all_interactions()
        if interactions:
            self.collab.fit(interactions)
        self._last_trained = time.time()

    def _maybe_retrain(self):
        if self._retraining:
            return
        if time.time() - self._last_trained < self.RETRAIN_INTERVAL:
            return
        self._retraining = True
        try:
            if self.content.needs_refit():
                self.content.fit(db.get_all_songs())
            self.collab.fit(db.get_all_interactions())
            self._last_trained = time.time()
        finally:
            self._retraining = False

    # ── Core recommendation ───────────────────────────────────────────────────

    def recommend(
        self,
        song_id: str,
        session_id: str,
        n: int = 6,
        mood_filter: Optional[str] = None,
    ) -> Tuple[List[Dict], Dict]:
        """
        Returns (recommendations, engine_info)
        engine_info has mode, weights, total_interactions for the UI.
        """
        self._maybe_retrain()

        w = db.get_engine_weights(session_id)
        cw = w["content_weight"]
        colw = w["collaborative_weight"]
        total = w["total_interactions"]

        mode = (
            "content" if total < 10
            else "hybrid" if colw < 0.5
            else "collaborative"
        )

        # --- Scores from each engine ---
        content_scores: Dict[str, float] = self.content.get_scores(song_id) if cw > 0 else {}
        collab_scores: Dict[str, float] = self.collab.get_scores(session_id, song_id) if colw > 0 else {}

        candidates = set(content_scores) | set(collab_scores)
        if not candidates:
            # Fallback: return top popular songs
            all_songs = db.get_all_songs()
            return [s for s in all_songs if str(s["id"]) != song_id][:n], {"mode": "fallback", **w}

        # --- Hybrid score ---
        scores: Dict[str, float] = {}
        for sid in candidates:
            cs = content_scores.get(sid, 0.0)
            co = collab_scores.get(sid, 0.0)
            scores[sid] = cw * cs + colw * co

        # --- Apply mood filter ---
        if mood_filter:
            mood_ids = {str(s["id"]) for s in self.content.get_mood_songs(mood_filter)}
            scores = {sid: v for sid, v in scores.items() if sid in mood_ids}

        # --- Apply user preference boost (liked/played before → slight boost) ---
        user_scores = db.get_user_song_scores(session_id)
        for sid in scores:
            user_score = user_scores.get(sid, 0)
            if user_score > 0:
                scores[sid] *= 1.1  # small boost for previously liked

        # --- Ranking: popularity + recency ---
        all_song_map = {str(s["id"]): s for s in (self.content.songs_df.to_dict("records") if self.content.songs_df is not None else db.get_all_songs())}
        for sid in list(scores.keys()):
            if sid not in all_song_map:
                continue
            s = all_song_map[sid]
            pop_boost = s.get("popularity", 50) / 1000.0  # max +0.1
            recency_boost = max(0, (s.get("year", 2000) - 2000) / 1000.0)  # max +0.024
            scores[sid] += pop_boost + recency_boost

        # --- Sort ---
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)

        # --- Diversity: limit same artist to 2 max ---
        seed_song = db.get_song_by_id(song_id)
        results, artist_count = [], {}
        for sid, _ in ranked:
            if sid == song_id:
                continue
            song = all_song_map.get(sid) or db.get_song_by_id(sid)
            if not song:
                continue
            artist = song.get("artist", "")
            if artist_count.get(artist, 0) >= 2:
                continue
            artist_count[artist] = artist_count.get(artist, 0) + 1
            results.append(song)
            if len(results) >= n:
                break

        engine_info = {
            "mode": mode,
            "content_weight": round(cw, 2),
            "collaborative_weight": round(colw, 2),
            "total_interactions": total,
        }
        return results, engine_info

    def get_personalized(self, session_id: str, n: int = 10) -> List[Dict]:
        """Pure collaborative recommendations for the session (no seed song needed)."""
        self._maybe_retrain()
        if not self.collab.trained or session_id not in self.collab.user_idx:
            return db.get_trending(n)

        u_vec = self.collab.user_factors[self.collab.user_idx[session_id]]
        raw = self.collab.item_factors @ u_vec
        ranked_idxs = np.argsort(raw)[::-1]

        seen = set(db.get_user_song_scores(session_id).keys())
        results = []
        for idx in ranked_idxs:
            sid = self.collab.item_idx_rev.get(int(idx))
            if sid and sid not in seen:
                song = db.get_song_by_id(sid)
                if song:
                    results.append(song)
            if len(results) >= n:
                break
        return results or db.get_trending(n)
