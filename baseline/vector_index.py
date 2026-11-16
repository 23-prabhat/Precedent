"""Exact cosine retrieval with FAISS; the recorded harness uses sparse fixture vectors."""
from collections import Counter
from math import sqrt
import re
from hashlib import sha256

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


def sparse(text):
    counts = Counter(re.findall(r"[a-z0-9]+", text.lower()))
    norm = sqrt(sum(n * n for n in counts.values())) or 1
    return {word: n / norm for word, n in counts.items()}


def cosine(a, b):
    if isinstance(a, dict):
        return sum(val * b.get(word, 0) for word, val in a.items())
    return float(a @ b)


class Encoder:
    def __init__(self, recorded=False):
        self.recorded = recorded
        self.document_cache = {}
        if not recorded:
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer(MODEL, revision=REVISION)

    def encode(self, texts):
        if self.recorded:
            return [sparse(text) for text in texts]
        return self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


    def document_vectors(self, docs):
        if self.recorded:
            return [doc.id for doc in docs], self.encode([doc.full_text for doc in docs])
        import numpy as np

        keys = [sha256(doc.full_text.encode()).digest() for doc in docs]
        new = {}
        for doc, key in zip(docs, keys):
            if key not in self.document_cache and key not in new:
                words = doc.full_text.split()
                chunks = [" ".join(words[start:start + 160]) for start in range(0, len(words), 140)]
                new[key] = chunks or [""]
        if new:
            embeddings = self.encode([chunk for chunks in new.values() for chunk in chunks])
            offset = 0
            for key, chunks in new.items():
                self.document_cache[key] = embeddings[offset:offset + len(chunks)]
                offset += len(chunks)
        vectors = [self.document_cache[key] for key in keys]
        ids = [doc.id for doc, group in zip(docs, vectors) for _ in group]
        return ids, np.concatenate(vectors) if vectors else []


class VectorIndex:
    def __init__(self, docs, encoder):
        self.encoder = encoder
        self.ids, self.vectors = encoder.document_vectors(docs)
        if docs and not encoder.recorded:
            import faiss
            self.index = faiss.IndexFlatIP(self.vectors.shape[1])
            self.index.add(self.vectors)

    def search(self, query, k=15):
        if not self.ids:
            return []
        vector = self.encoder.encode([query])
        if self.encoder.recorded:
            return sorted(zip(self.ids, (cosine(vector[0], x) for x in self.vectors)),
                          key=lambda item: (-item[1], item[0]))[:k]
        scores, positions = self.index.search(vector, min(k, len(self.ids)))
        return [(self.ids[pos], float(score)) for pos, score in zip(positions[0], scores[0])]
