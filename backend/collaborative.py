"""
Collaborative Filtering via SVD (Truncated Singular Value Decomposition).
Learns latent user/item factors from the interaction matrix.
Falls back to item-item CF when user is new to the session.
"""
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import svds
from typing import Dict, List, Tuple, Optional


class CollaborativeRecommender:
    def __init__(self, n_factors: int = 20):
        self.n_factors = n_factors
        self.user_factors: Optional[np.ndarray] = None   # (U, k)
        self.item_factors: Optional[np.ndarray] = None   # (I, k)
        self.user_idx: Dict[str, int] = {}
        self.item_idx: Dict[str, int] = {}
        self.item_idx_rev: Dict[int, str] = {}
        self.trained = False

    def fit(self, interactions: List[Tuple]):
        """interactions: [(session_id, song_id, score)]"""
        if len(interactions) < 5:
            self.trained = False
            return

        users = list({r[0] for r in interactions})
        items = list({r[1] for r in interactions})

        if len(users) < 2 or len(items) < 3:
            self.trained = False
            return

        self.user_idx = {u: i for i, u in enumerate(users)}
        self.item_idx = {it: i for i, it in enumerate(items)}
        self.item_idx_rev = {i: it for it, i in self.item_idx.items()}

        rows, cols, data = [], [], []
        for uid, iid, score in interactions:
            if score > 0:
                rows.append(self.user_idx[uid])
                cols.append(self.item_idx[iid])
                data.append(float(score))

        if not rows:
            self.trained = False
            return

        mat = csr_matrix((data, (rows, cols)), shape=(len(users), len(items)), dtype=np.float32)
        k = min(self.n_factors, min(mat.shape) - 1)
        if k < 1:
            self.trained = False
            return

        try:
            U, sigma, Vt = svds(mat.astype(float), k=k)
            self.user_factors = U * sigma   # (U, k)
            self.item_factors = Vt.T        # (I, k)
            self.trained = True
        except Exception:
            self.trained = False

    def get_scores(self, session_id: str, seed_song_id: str) -> Dict[str, float]:
        if not self.trained:
            return {}

        # Known user → predict from user vector
        if session_id in self.user_idx:
            u_vec = self.user_factors[self.user_idx[session_id]]
            raw = self.item_factors @ u_vec
            mn, mx = raw.min(), raw.max()
            norm = (raw - mn) / (mx - mn + 1e-9)
            return {
                self.item_idx_rev[i]: float(norm[i])
                for i in range(len(norm))
                if self.item_idx_rev.get(i) != seed_song_id and norm[i] > 0
            }

        # Cold session → item-item CF from seed song
        if seed_song_id in self.item_idx:
            seed_vec = self.item_factors[self.item_idx[seed_song_id]]
            scores = {}
            for iid, idx in self.item_idx.items():
                if iid == seed_song_id:
                    continue
                v = self.item_factors[idx]
                denom = np.linalg.norm(seed_vec) * np.linalg.norm(v) + 1e-9
                sim = float(np.dot(seed_vec, v) / denom)
                if sim > 0:
                    scores[iid] = sim
            return scores

        return {}
