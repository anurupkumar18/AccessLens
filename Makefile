.PHONY: check memory-check extension-check

memory-check:
	python3 scripts/memory_check.py

extension-check:
	npm run check

check: memory-check extension-check
	@echo "AccessLens documentation and extension checks passed."
