from dataclasses import asdict, dataclass, field
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/out"
CACHE = ROOT / "data/cache"


@dataclass
class Document:
    id: str
    title: str
    full_text: str
    doc_type: str = "incident"
    iid: int = 0
    created_at: str = ""
    closed_at: str = ""
    url: str = ""
    alert_title: str = ""
    services: list[str] = field(default_factory=list)
    root_cause: str = "unlabeled"
    severity: str = ""
    symptom_text: str = ""
    review_id: str = ""
    review_text: str = ""
    fix_refs: list[str] = field(default_factory=list)
    used_fallback: bool = False

    def json(self):
        return asdict(self)


def read_manifest(path=OUT / "manifest.jsonl"):
    return [Document(**json.loads(line)) for line in path.read_text().splitlines() if line.strip()]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temp.replace(path)
