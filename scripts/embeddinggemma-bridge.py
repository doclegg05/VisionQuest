#!/usr/bin/env python3
"""Loopback-only VisionQuest AI bridge: Gemma 4 12B + EmbeddingGemma 2.

Run with the isolated embedding runtime; VQ_EMBEDDING_MODEL_DIR points to the
downloaded official checkpoint. Inputs are already task-prefixed by the app.
"""
import os
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import json
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import SentenceTransformer

CHAT = "gemma4:12b"
EMBED = "google/embeddinggemma-2"
OLLAMA = "http://127.0.0.1:11434"
MODEL_DIR = Path(os.environ.get("VQ_EMBEDDING_MODEL_DIR", str(Path.home() / ".local/share/visionquest/embeddinggemma-2/model")))
model = SentenceTransformer(str(MODEL_DIR), local_files_only=True, device="mps" if torch.backends.mps.is_available() else "cpu",
                            config_kwargs={"vision_config": None, "audio_config": None}, model_kwargs={"dtype": torch.float32})
model.max_seq_length = 8192
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    # No prompt, request-body, or vector logging.
    def log_message(self, *_args):
        pass

    def respond(self, status, value):
        payload = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            return self.respond(200, {"ready": True, "model": EMBED, "dimensions": 768, "chat_model": CHAT})
        if self.path == "/api/version":
            return self.respond(200, {"version": "visionquest-embedding-bridge-1"})
        if self.path in ("/api/tags", "/v1/models"):
            # Reflect actual Ollama availability; never advertise other host models.
            try:
                with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=5) as response:
                    tags = json.load(response)
                entries = [entry for entry in tags["models"] if entry["name"] == CHAT]
            except (OSError, ValueError):
                entries = []
            entries.append({"name": EMBED, "model": EMBED, "capabilities": ["embedding"],
                            "details": {"family": "embedding_gemma2", "parameter_size": "270M active text"}})
            if self.path == "/v1/models":
                return self.respond(200, {"object": "list", "data": [{"id": e["name"], "object": "model"} for e in entries]})
            return self.respond(200, {"models": entries})
        self.respond(404, {"error": "Unknown endpoint"})

    def do_POST(self):
        # Reject browser cross-origin calls; this endpoint is server-to-server only.
        if self.headers.get("Origin"):
            return self.respond(403, {"error": "Browser origins are not supported"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8 * 1024 * 1024:
                return self.respond(413, {"error": "Request must be between 1 byte and 8 MiB"})
            self.connection.settimeout(30)
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError("Expected an object")
            if self.path in ("/api/embed", "/v1/embeddings"):
                if body.get("model") != EMBED:
                    raise ValueError("Use the exact model google/embeddinggemma-2")
                texts = body.get("input")
                if isinstance(texts, str):
                    texts = [texts]
                if not isinstance(texts, list) or not 1 <= len(texts) <= 96 or any(not isinstance(t, str) or not t.strip() for t in texts):
                    raise ValueError("Expected 1 to 96 nonempty text inputs")
                with lock, torch.inference_mode():
                    lengths = [len(model.tokenizer.encode(t)) for t in texts]
                    if max(lengths) > 8192:
                        raise ValueError("Input exceeds the supported 8192-token context; chunk it first")
                    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False, batch_size=8)
                if vectors.shape != (len(texts), 768) or not np.isfinite(vectors).all():
                    raise RuntimeError("Invalid embedding output")
                if not np.allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=1e-5):
                    raise RuntimeError("Invalid embedding norm")
                if self.path == "/api/embed":
                    return self.respond(200, {"model": EMBED, "embeddings": vectors.tolist(), "prompt_eval_count": sum(lengths)})
                return self.respond(200, {"object": "list", "model": EMBED,
                    "data": [{"object": "embedding", "index": i, "embedding": v.tolist()} for i, v in enumerate(vectors)],
                    "usage": {"prompt_tokens": sum(lengths), "total_tokens": sum(lengths)}})
            if self.path == "/api/show" and body.get("model") == EMBED:
                return self.respond(200, {"capabilities": ["embedding"], "model_info": {"general.architecture": "embedding_gemma2", "embedding_gemma2.embedding_length": 768}})
            if self.path not in ("/api/chat", "/api/show", "/api/generate", "/v1/chat/completions"):
                return self.respond(404, {"error": "Unknown endpoint"})
            if body.get("model") != CHAT:
                raise ValueError("VisionQuest only serves gemma4:12b for local generative requests")
            request = urllib.request.Request(OLLAMA + self.path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=300) as response:
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.end_headers()
                # HTTP/1.0 closes at completion; preserve streaming NDJSON/SSE.
                while chunk := response.read1(65536):
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except (ValueError, TypeError) as error:
            self.respond(400, {"error": str(error)})
        except urllib.error.HTTPError as error:
            self.respond(error.code, {"error": "Ollama rejected the request"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond(503, {"error": "Local model unavailable"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 11436), Handler)
    server.daemon_threads = True
    print("VisionQuest local bridge ready at http://127.0.0.1:11436", flush=True)
    server.serve_forever()
