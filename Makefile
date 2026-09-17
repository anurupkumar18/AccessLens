.PHONY: check memory-check pack-check relay-check work-board-check work-board agent-context extension-check live-session-check ai-gateway-check freeze-check deploy-preflight

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

work-board-check:
	python3 scripts/work_board_check.py
	python3 -m unittest discover -s tests/work

work-board:
	python3 scripts/work_board.py

agent-context:
	python3 scripts/agent_context.py

extension-check:
	npm run check

# Part 4. Its own package with its own dependencies, so it needs its own
# install; kept separate from extension-check so a failure here names the relay
# rather than the extension.
live-session-check:
	cd services/live-session && npm run check

# The AI routes (Bedrock answers, Polly speech, Transcribe caption URLs) are
# their own package too, for the same reason as the relay.
ai-gateway-check:
	cd services/ai-gateway && npm run check

# Handover gate. Run at feature freeze: fails while any part is unowned or any
# thread is neither closed with evidence nor consciously accepted.
freeze-check:
	python3 scripts/relay_check.py --freeze

check: memory-check pack-check relay-check work-board-check extension-check live-session-check ai-gateway-check
	@echo "AccessLens documentation, delivery board, Access Pack, relay, extension, live-session, and ai-gateway checks passed."

# Is the repository ready to deploy the demo? Reports per part; run the script
# directly with --aws to also probe the account.
deploy-preflight:
	python3 scripts/deploy_preflight.py

# V2 temporary authoring API deployment. The scripts use bounded AWS/CDK calls.
deploy:
	./infra/scripts/deploy.sh

smoke:
	./infra/scripts/smoke.sh

destroy:
	./infra/scripts/destroy.sh
