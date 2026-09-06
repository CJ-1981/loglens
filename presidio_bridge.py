"""presidio_bridge.py — CORS-enabled, IVI-tuned Presidio endpoint for LogLens.

LogLens's deep scan (pii scan tab) posts masked log samples straight from the
browser, so the analyzer endpoint must send CORS headers. The stock
presidio-analyzer Docker image does not, and modifying it is fiddly — this
FastAPI bridge runs Presidio in-process instead, tuned for in-vehicle
infotainment / telematics logs:

  * custom pattern recognizers for the identifiers IVI logs actually carry:
    VIN (with check-digit validation), IMEI (Luhn), GNSS lat/lon pairs,
    MAC/BT addresses, and an optional license-plate recognizer (off by
    default — plate formats are region-specific, see LICENSE_PLATE below)
  * the NER allow-list is PERSON / LOCATION / ORG only — the stock DATE_TIME
    recognizer fires on every log timestamp and buries real findings
  * telematics context words (vin, imei, bssid, paired_device, driver_id, …)
    boost genuine hits and suppress incidental ones
  * the NLP engine/model is configurable via env vars for better PERSON
    recall on log noise or non-Latin contact names — see MODELS below

Run it:

    pip install presidio-analyzer fastapi "uvicorn[standard]"
    python -m spacy download en_core_web_lg          # default NER model
    python presidio_bridge.py                        # http://localhost:8699

MODELS (set before starting; see README "Tuning Presidio for IVI logs"):
    PRESIDIO_NLP_ENGINE=spacy         PRESIDIO_NLP_MODEL=en_core_web_lg     # default
    PRESIDIO_NLP_ENGINE=transformers  PRESIDIO_NLP_MODEL=dslim/bert-base-NER
    PRESIDIO_NLP_ENGINE=stanza        PRESIDIO_NLP_MODEL=en

If you already run the presidio-analyzer image (port 3000) behind any CORS
proxy, point LogLens at that instead — the request/response contract is the
same as presidio-analyzer's POST /analyze (this bridge additionally accepts
an "entities" filter like the stock service).
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider

app = FastAPI(title="loglens-presidio-bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # LogLens may be opened from file:// or Pages
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------- NLP engine
# spacy en_core_web_lg is the balanced default; transformers models
# (dslim/bert-base-NER, Jean-Baptiste/roberta-large-ner-english) buy PERSON
# recall on noisy log text at CPU cost; stanza / multilingual HF models cover
# non-Latin contact names from global fleets.
NLP_ENGINE = os.environ.get("PRESIDIO_NLP_ENGINE", "spacy").lower()
NLP_MODEL = os.environ.get("PRESIDIO_NLP_MODEL", "en_core_web_lg")

_nlp_configuration = {"nlp_engine_name": NLP_ENGINE, "models": [{"model_name": NLP_MODEL}]}
if NLP_ENGINE == "transformers":
    _nlp_configuration["models"][0]["pipeline"] = "ner"
nlp_engine = NlpEngineProvider(nlp_configuration=_nlp_configuration).create_engine()

# ------------------------------------------------- custom IVI recognizers ---
def _vin_valid(text: str):
    """ISO 3779 check digit: transliterate letters, weight positions, mod 11."""
    if len(text) != 17 or any(c in "IOQ" for c in text.upper()):
        return False
    t = str.maketrans("ABCDEFGHJKLMNPRSTUVWXYZ0123456789", "12345678912345678901234567890")
    weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
    total = sum(int(c.translate(t)) * w for c, w in zip(text.upper(), weights))
    check = "X" if total % 11 == 10 else str(total % 11)
    return text.upper()[8] == check


def _luhn_valid(text: str):
    total, alt = 0, False
    for ch in reversed(text):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


CUSTOM_RECOGNIZERS = [
    PatternRecognizer(
        supported_entity="VIN", name="IVI VIN (check digit)",
        patterns=[Pattern("vin-17", r"\b[A-HJ-NPR-Z0-9]{17}\b", 0.6)],
        validate_result=_vin_valid,
        context=["vin", "vehicle", "chassis", "frame", "serial number"],
    ),
    PatternRecognizer(
        supported_entity="IMEI", name="IVI IMEI (Luhn)",
        patterns=[Pattern("imei-15", r"\b\d{15}\b", 0.6)],
        validate_result=_luhn_valid,
        context=["imei", "modem", "device id", "meid"],
    ),
    PatternRecognizer(
        supported_entity="GNSS_COORDINATE", name="IVI GNSS pair",
        # decimal lat/lon pair (>=3 decimals), optional N/S/E/W and comma —
        # rejects 2-decimal values so version/benchmark numbers do not match
        patterns=[Pattern(
            "gnss-pair",
            r"(?<![\d.])-?(?:[0-8]?\d|90)\.\d{3,7}\s*°?\s*[NS]?\s*,?\s*-?(?:1?[0-7]?\d|180)\.\d{3,7}(?:\s*°?\s*[EW])?(?![\d.])",
            0.7)],
        context=["position", "gps", "gnss", "lat", "lon", "coordinates", "fix"],
    ),
    PatternRecognizer(
        supported_entity="MAC_ADDRESS", name="IVI MAC/BT address",
        patterns=[Pattern("mac", r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b", 0.7)],
        context=["mac", "bssid", "ssid", "bluetooth", "bt", "wifi", "wlan", "address"],
    ),
    # Off by default: plate formats are jurisdiction-specific and a loose regex
    # mostly catches ordinary tokens. Add "LICENSE_PLATE" to DEFAULT_ENTITIES
    # (or request it per call) and edit the pattern for your market.
    PatternRecognizer(
        supported_entity="LICENSE_PLATE", name="IVI license plate (tune per region)",
        patterns=[Pattern("plate-eu-generic", r"\b[A-HJ-PR-Z]{2,3}[ -][A-Z0-9]{1,2}[ -][A-HJ-PR-Z]{2,3}\b", 0.5)],
        context=["plate", "registration", "plate no"],
    ),
]

registry = RecognizerRegistry(supported_languages=["en"])
registry.load_predefined_recognizers(supported_languages=["en"])  # stock recognizers (IP, email, phone, …)
for r in CUSTOM_RECOGNIZERS:
    registry.add_pattern_recognizer(r)

analyzer = AnalyzerEngine(nlp_engine=nlp_engine, registry=registry, supported_languages=["en"])

# What /analyze looks for when the request doesn't say. Deliberately narrow:
# NER is limited to PERSON/LOCATION/ORG (CoNLL-style models fire DATE_TIME on
# every log timestamp); everything else here is pattern/checksum backed.
DEFAULT_ENTITIES = [
    "PERSON", "LOCATION", "ORG",
    "IP_ADDRESS", "EMAIL_ADDRESS", "PHONE_NUMBER", "URL", "CREDIT_CARD",
    "IBAN_CODE", "US_SSN",
    "VIN", "IMEI", "GNSS_COORDINATE", "MAC_ADDRESS",
]


class AnalyzeRequest(BaseModel):
    text: str
    language: str = "en"
    score_threshold: float = 0.4
    entities: list[str] | None = None
    return_decision_process: bool = Field(default=False, exclude=True)


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    results = analyzer.analyze(
        text=req.text,
        language=req.language,
        entities=req.entities or DEFAULT_ENTITIES,
        score_threshold=req.score_threshold,
        return_decision_process=req.return_decision_process,
    )
    # same shape as presidio-analyzer's REST service
    return {"results": [
        {"start": r.start, "end": r.end, "entity_type": r.entity_type,
         "score": r.score, "recognition_metadata": {
             "source": r.recognition_metadata.get("recognizer_name", "") if r.recognition_metadata else ""}}
        for r in results
    ]}


@app.get("/health")
def health():
    return {"status": "ok", "nlp_engine": NLP_ENGINE, "model": NLP_MODEL}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8699)
