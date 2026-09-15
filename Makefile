.PHONY: check memory-check pack-check extension-check

memory-check:
	python3 scripts/memory_check.py

pack-check:
	python3 packages/access-packs/bio-cell-demo/tools/validate_pack.py
	python3 packages/access-packs/bio-cell-demo/tools/check_contract_conformance.py
	python3 packages/access-packs/bio-cell-demo/tools/generate_review_sheet.py --check
	python3 -m unittest discover -s tests/access_pack

extension-check:
	npm run check

check: memory-check pack-check extension-check
	@echo "AccessLens documentation, Access Pack, and extension checks passed."
