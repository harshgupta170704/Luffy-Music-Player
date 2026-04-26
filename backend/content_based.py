"""
Content-Based Recommender using cosine similarity on audio features.
Faster and more accurate than KNN for dense feature vectors.
"""
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics.pairwise import cosine_similarity
from typing import Dict, List, Optional
import database as db

FEATURES = [
    "danceability", "energy", "valence", "tempo",
    "acousticness", "instrumentalness", "liveness", "speechiness",
]


class ContentBasedRecommender:
    def __init__(self):
        self.scaler = MinMaxScaler()
        self.songs_df: Optional[pd.DataFrame] = None
        self.sim_matrix: Optional[np.ndarray] = None
        self._id_to_idx: Dict[str, int] = {}

    def fit(self, songs: List[Dict]):
        if not songs:
            return
        self.songs_df = pd.DataFrame(songs)
        self.songs_df["id"] = self.songs_df["id"].astype(str)
        self._id_to_idx = {sid: i for i, sid in enumerate(self.songs_df["id"])}

        feature_matrix = self.songs_df[FEATURES].fillna(0).values
        scaled = self.scaler.fit_transform(feature_matrix)
        self.sim_matrix = cosine_similarity(scaled)  # (N x N)

    def get_scores(self, song_id: str) -> Dict[str, float]:
        if self.sim_matrix is None or song_id not in self._id_to_idx:
            return {}
        idx = self._id_to_idx[song_id]
        sims = self.sim_matrix[idx]
        scores = {}
        for other_id, other_idx in self._id_to_idx.items():
            if other_id != song_id:
                scores[other_id] = float(sims[other_idx])
        return scores

    def get_mood_songs(self, mood: str) -> List[Dict]:
        if self.songs_df is None:
            return []
        df = self.songs_df
        filters = {
            "happy":   (df["valence"] > 0.6) & (df["energy"] > 0.5),
            "chill":   (df["energy"] < 0.5)  & (df["valence"] > 0.35),
            "intense": (df["energy"] > 0.75) & (df["tempo"] > 120),
            "sad":     (df["valence"] < 0.4) & (df["energy"] < 0.55),
        }
        mask = filters.get(mood, pd.Series([True] * len(df), index=df.index))
        return df[mask].to_dict("records")

    def needs_refit(self) -> bool:
        return self.songs_df is None or len(db.get_all_songs()) != len(self.songs_df)
