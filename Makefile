.PHONY: check memory-check relay-check extension-check freeze-check

memory-check:
	python3 scripts/memory_check.py

relay-check:
	python3 scripts/relay_check.py

extension-check:
	npm run check

# Handover gate. Run at feature freeze: fails while any part is unowned or any
# thread is neither closed with evidence nor consciously accepted.
freeze-check:
	python3 scripts/relay_check.py --freeze

check: memory-check relay-check extension-check
	@echo "AccessLens documentation, relay, and extension checks passed."
