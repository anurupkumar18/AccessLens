# Copy-ready team summary

AccessLens is now our main hackathon idea. It is a browser extension for the
one-format classroom problem: when an instructor shows a dense slide, diagram,
video, website, or software demonstration, students who cannot access or process
that format can lose the lesson while the class keeps moving.

The instructor starts one AccessLens session and explicitly shares a tab, window,
or screen. The instructor extension identifies the current approved slide and
sends only small events such as the slide ID, highlighted region, pointer location,
or caption. Student extensions follow automatically and render the same moment as
Focus View, structured text, captions, requested audio, spatial guidance, and
synchronized AR. No student camera is required.

For the MVP, we will show one instructor biology deck updating two student
extensions and an interactive AR cell model in real time through AWS WebSockets. AR
is core. Camera recognition is the advanced source adapter for labs, specimens,
equipment, studio work, field observations, and other physical content that cannot
be screen-shared.

The full proposal is in `docs/ACCESSLENS_PROPOSAL.md`, and the stack and architecture
are in `docs/SYSTEM_DESIGN.md`.
