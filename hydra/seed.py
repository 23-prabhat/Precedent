import json

from dotenv import load_dotenv

from data.model import OUT, read_manifest
from hydra.contract import Hydra


def seed():
    load_dotenv()
    remote = Hydra()
    docs = read_manifest()
    report_path = OUT / "spikes.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    typed = report.get("S8", {}).get("status") == "pass"
    remote.separate = remote.separate or report.get("S9", {}).get("status") == "fail"
    remote.ensure_database(collections=("plain", "learn", "declared") if typed else ("plain", "learn"))
    remote.ingest(docs, "plain")
    if typed:
        remote.ingest(docs, "declared", typed=True)
    remote.ingest(docs, "learn", typed=typed)
    print(remote.counts)


if __name__ == "__main__":
    seed()
