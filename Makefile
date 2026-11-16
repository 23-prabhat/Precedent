PYTHON ?= .venv/bin/python
SINCE ?= 2023-01-01T00:00:00Z
DATA_LIMIT ?= 0
ARGS ?=

.PHONY: setup setup-eval inspect data spikes seed mine eval eval-cache eval-live eval-fixture api web build check
setup:
	python3.11 -m venv .venv
	.venv/bin/pip install -r requirements.txt
	npm --prefix web ci

setup-eval:
	.venv/bin/pip install -r requirements-eval.txt

inspect:
	$(PYTHON) -m data.scrape_gitlab --limit 50
	$(PYTHON) -m data.scrape_gitlab --limit 500 --since $(SINCE)

data:
	$(PYTHON) -m data.parse --limit $(DATA_LIMIT) --since $(SINCE) $(ARGS)

spikes:
	$(PYTHON) -m hydra.spikes $(ARGS)

seed:
	$(PYTHON) -m hydra.seed

mine:
	$(PYTHON) -m data.triples $(ARGS)

eval:
	$(PYTHON) -m eval.replay --recorded --recompute $(ARGS)

eval-fixture:
	$(PYTHON) -m eval.replay --recorded $(ARGS)

eval-cache:
	$(PYTHON) -m eval.replay --recompute $(ARGS)

eval-live:
	$(PYTHON) -m eval.replay $(ARGS)

api:
	$(PYTHON) -m uvicorn api.main:app --host 127.0.0.1 --port 8000

web:
	npm --prefix web run dev

build:
	npm --prefix web run build

check:
	$(PYTHON) -m unittest discover -s tests -v
	npm --prefix web run build

.PHONY: demo-data
demo-data:
	$(PYTHON) -m data.build_demo
