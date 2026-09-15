.PHONY: check memory-check relay-check freeze-check

memory-check:
	python3 scripts/memory_check.py

relay-check:
	python3 scripts/relay_check.py

# Handover gate. Run at feature freeze: fails while any part is unowned or any
# thread is neither closed with evidence nor consciously accepted.
freeze-check:
	python3 scripts/relay_check.py --freeze

check: memory-check relay-check
	@echo "AccessLens documentation reset validated. Extension checks will be added with Phase 1."
