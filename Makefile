.PHONY: check memory-check pack-check

memory-check:
	python3 scripts/memory_check.py

pack-check:
	python3 packages/access-packs/bio-cell-demo/tools/validate_pack.py
	python3 -m unittest discover -s tests/access_pack

check: memory-check pack-check
	@echo "AccessLens documentation and Access Pack checks passed. Extension checks will be added with Phase 1."
