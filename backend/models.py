from pydantic import BaseModel
from typing import Optional, List, Any


class Song(BaseModel):
    id: str
    name: str
    artist: str
    album: str
    genre: str
    danceability: float
    energy: float
    valence: float
    tempo: float
    acousticness: float
    instrumentalness: float
    liveness: float
    speechiness: float
    loudness: float
    popularity: int
    year: int
    album_art: Optional[str] = None
    preview_url: Optional[str] = None
    play_count: int = 0
    like_count: int = 0
    skip_count: int = 0


class RecommendRequest(BaseModel):
    song_id: str
    session_id: str
    n: int = 6
    mood_filter: Optional[str] = None   # happy | chill | intense | sad


class RecommendResponse(BaseModel):
    seed_song: Song
    recommendations: List[Song]
    engine_info: dict


class InteractRequest(BaseModel):
    session_id: str
    song_id: str
    interaction_type: str   # play | like | skip | add_playlist | search_click
    context: Optional[str] = None


class AddSongRequest(BaseModel):
    id: str
    name: str
    artist: str
    album: str
    genre: str
    danceability: float = 0.5
    energy: float = 0.5
    valence: float = 0.5
    tempo: float = 120.0
    acousticness: float = 0.1
    instrumentalness: float = 0.0
    liveness: float = 0.1
    speechiness: float = 0.05
    loudness: float = -7.0
    popularity: int = 50
    year: int = 2024
    album_art: Optional[str] = None
    preview_url: Optional[str] = None


class SearchResponse(BaseModel):
    songs: List[Song]
    total: int
