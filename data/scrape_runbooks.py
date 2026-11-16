import re
import subprocess
from tempfile import TemporaryDirectory
from pathlib import Path

from data.model import CACHE, Document

REPO = "https://gitlab.com/gitlab-com/runbooks"
GIT_DIR = CACHE / "runbooks"


def runbooks(as_of, repo=GIT_DIR):
    if not repo.exists():
        repo.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--no-checkout", "--filter=blob:none", REPO + ".git", str(repo)], check=True)

    def git(*args):
        return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()

    commit = git("rev-list", "-1", f"--before={as_of}", "HEAD")
    if not commit:
        return [], ""
    docs = []
    with TemporaryDirectory(dir=repo.parent, prefix="runbooks-snapshot-") as directory:
        snapshot = Path(directory) / "files"
        git("worktree", "add", "--detach", "--no-checkout", str(snapshot), commit)
        try:
            subprocess.run(["git", "-C", str(snapshot), "sparse-checkout", "set", "--cone", "docs"], check=True)
            subprocess.run(["git", "-C", str(snapshot), "reset", "--hard", commit], check=True, stdout=subprocess.DEVNULL)
            for path in sorted((snapshot / "docs").rglob("*.md")):
                name = path.relative_to(snapshot).as_posix()
                text = path.read_text(errors="replace").strip()
                if not text:
                    continue
                heading = re.search(r"^#\s+(.+)", text, re.M)
                docs.append(Document(id=source_id(name), title=heading[1] if heading else path.stem,
                                     full_text=text, doc_type="runbook", created_at=as_of,
                                     url=f"{REPO}/-/blob/{commit}/{name}",
                                     services=list(path.relative_to(snapshot).parts[1:2])))
        finally:
            git("worktree", "remove", "--force", str(snapshot))
    return docs, commit


def source_id(path):
    return "rb-" + re.sub(r"[^a-z0-9]+", "-", path.removeprefix("docs/").removesuffix(".md").lower()).strip("-")
