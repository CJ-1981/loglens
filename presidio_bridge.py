"""presidio_bridge.py — CORS-enabled local wrapper for Microsoft Presidio.

LogLens's deep scan (pii scan tab) posts masked log samples straight from the
browser, so the analyzer endpoint must send CORS headers. The stock
presidio-analyzer Docker image does not, and modifying it is fiddly — this
~40-line FastAPI bridge runs Presidio in-process instead:

    pip install presidio-analyzer fastapi "uvicorn[standard]"
    python -m spacy download en_core_web_lg          # for PERSON/LOCATION NER
    python presidio_bridge.py                        # serves http://localhost:8699

Then in LogLens: pii scan -> deep scan -> engine "presidio analyzer endpoint",
URL http://localhost:8699, tick the consent box, press "deep scan".

If you already run the presidio-analyzer image (port 3000) behind any CORS
proxy, point LogLens at that instead — the request/response contract is the
same as presidio-analyzer's POST /analyze.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from presidio_analyzer import AnalyzerEngine

app = FastAPI(title="loglens-presidio-bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # LogLens may be opened from file:// or Pages
    allow_methods=["*"],
    allow_headers=["*"],
)
_analyzer = AnalyzerEngine()


class AnalyzeRequest(BaseModel):
    text: str
    language: str = "en"
    score_threshold: float = 0.4
    entities: list[str] | None = None


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    results = _analyzer.analyze(
        text=req.text,
        language=req.language,
        entities=req.entities,
        score_threshold=req.score_threshold,
        return_decision_process=False,
    )
    # same shape as presidio-analyzer's REST service
    return {"results": [
        {"start": r.start, "end": r.end, "entity_type": r.entity_type,
         "score": r.score, "recognition_metadata": r.analysis_explanation and {}}
        for r in results
    ]}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8699)
