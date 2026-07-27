from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.database import Base, SessionLocal, engine
from app.models import GlossaryTerm
from app.routers import categories, glossary, media, practice, sentences, stats, vocab
from app.services.range_file import serve_file_range

Base.metadata.create_all(bind=engine)

DEFAULT_GLOSSARY = [
    ("Watchman Nee", "人名"),
    ("Witness Lee", "人名"),
    ("the divine dispensing", "神的分赐"),
    ("the economy of God", "神的经纶"),
    ("the organic Body of Christ", "基督有机的身体"),
    ("the mingling of God and man", "神人的调和"),
    ("the all-inclusive Spirit", "包罗万有的灵"),
    ("transformation", "变化"),
    ("the processed Triune God", "经过过程的三一神"),
]


def _seed_glossary():
    db = SessionLocal()
    try:
        if db.query(GlossaryTerm).count() == 0:
            db.add_all([GlossaryTerm(term=t, note=n) for t, n in DEFAULT_GLOSSARY])
            db.commit()
    finally:
        db.close()


_seed_glossary()

app = FastAPI(title="水流职事英语跟读平台")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/media/{filename:path}")
async def serve_media_file(filename: str, request: Request):
    return await serve_file_range(request, config.MEDIA_DIR, filename)


@app.get("/audio_clips/{filename:path}")
async def serve_audio_clip_file(filename: str, request: Request):
    return await serve_file_range(request, config.AUDIO_CLIPS_DIR, filename)


@app.get("/recordings/{filename:path}")
async def serve_recording_file(filename: str, request: Request):
    return await serve_file_range(request, config.RECORDINGS_DIR, filename)

app.include_router(categories.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(sentences.router, prefix="/api")
app.include_router(practice.router, prefix="/api")
app.include_router(vocab.router, prefix="/api")
app.include_router(glossary.router, prefix="/api")
app.include_router(stats.router, prefix="/api")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "deepseek_enabled": config.DEEPSEEK_ENABLED,
        "azure_enabled": config.AZURE_ENABLED,
    }
