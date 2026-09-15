.PHONY: check memory-check

memory-check:
	python3 scripts/memory_check.py

check: memory-check
	@echo "AccessLens documentation reset validated. Extension checks will be added with Phase 1."
