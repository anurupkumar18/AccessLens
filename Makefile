.PHONY: check memory-check pack-check relay-check extension-check freeze-check

memory-check:
	python3 scripts/memory_check.py

pack-check:
	python3 packages/access-packs/bio-cell-demo/tools/validate_pack.py
	python3 packages/access-packs/bio-cell-demo/tools/check_contract_conformance.py
	python3 packages/access-packs/bio-cell-demo/tools/generate_review_sheet.py --check
	python3 -m unittest discover -s tests/access_pack

relay-check:
	python3 scripts/relay_check.py
	python3 -m unittest discover -s tests/relay

extension-check:
	npm run check

# Handover gate. Run at feature freeze: fails while any part is unowned or any
# thread is neither closed with evidence nor consciously accepted.
freeze-check:
	python3 scripts/relay_check.py --freeze

check: memory-check pack-check relay-check extension-check
	@echo "AccessLens documentation, Access Pack, relay, and extension checks passed."
