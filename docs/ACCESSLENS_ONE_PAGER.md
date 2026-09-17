# AccessLens

## Executive summary

AccessLens helps students access the same live lesson in the format they need.
An instructor shares one screen once. AccessLens creates focused visuals, readable
text, audio, captions, dyslexic-friendly text, and an optional spatial view.

Students choose privately. They do not need to disclose a diagnosis or use a
camera. The instructor keeps control of what is shared.

## The problem

A live class moves at one speed and one visual format. That creates a practical
barrier for students who cannot see small diagrams, read dense slides, hear every
word, process rapid transitions, or follow a second language.

Today, students often ask the instructor to stop, arrange separate help, or miss
the explanation. Instructors must repeat material while teaching the rest of the
class. Existing accessibility tools usually address a document or recording.
They do not bridge the moment instruction is happening.

This is a real inclusion and adoption problem. RAND reports that 54% of students
and 53% of teachers used AI for schoolwork, while more than 80% of students said
teachers had not explicitly taught them how to use AI for schoolwork. That gap
shows demand for useful, guided technology rather than another unrestricted bot.

## What we learned from users

We completed an exploratory needs check with four people:

- two low-vision participants;
- one participant with ADHD; and
- one Deaf or hard-of-hearing participant.

This is directional evidence, not a statistically representative survey. Replace
the placeholders below before submission:

- **[N] of 4** participants reported missing information during live instruction.
- **[N] of 4** wanted control over text size, focus, or pacing.
- **[N] of 4** wanted support without repeatedly interrupting the instructor.
- Representative quote: “**[insert consented quote]**.”
- Recruitment method: **[insert method and date]**.

The University of Utah’s Center for Disability & Access provides accommodations,
but a student still needs an accessible way to follow the shared classroom moment.
AccessLens complements formal accommodations. It does not replace them.

## The solution

The instructor clicks Start and approves a browser share. AccessLens captures the
selected tab, window, or screen. A configured AWS analysis service can extract text
with Textract and interpret diagrams or layout with a Bedrock multimodal model.
The service returns a small accessibility object, not a recording.

Students receive the same lesson moment through their selected mode:

- **Focus:** highlights the important region and removes clutter.
- **Read:** presents extracted text, headings, and a concise summary.
- **Hear:** reads the visual explanation with Polly or browser speech.
- **Dyslexic:** applies local spacing, font, and line-length preferences.
- **Captions:** shows instructor speech as text through Transcribe.
- **AR:** turns supported concepts into an explorable spatial model.

For a lab or physical demonstration, an instructor or shared lab device can later
use an explicitly permitted camera. Students do not need cameras.

## Why this is different

AccessLens is a shared accessibility layer, not a chatbot students must configure.
One instructor action creates several student-controlled representations.
The current repository includes the extension shell, live session contract,
student modes, AR cell renderer, AWS gateway integrations, course library, upload
and review flow, and screen-analysis event contract.

## AWS architecture

Browser capture → API Gateway → Lambda → Textract/Bedrock → semantic accessibility
object → WebSocket relay → student extensions.

Polly supports requested audio. Transcribe supports instructor captions. DynamoDB
holds temporary session state. S3 stores approved course assets when an instructor
publishes them. Bedrock Guardrails and schema validation protect model output.

## Benefits and measurable targets

- Give students an accessible representation within **[target seconds]** of a
  screen change.
- Reduce clarification or repetition requests by **[target %]** in a pilot.
- Let **[target %]** of participants choose a mode without instructor assistance.
- Support **[target number]** courses with the same extension and service contract.
- Reach **[target number]** student testers across low vision, ADHD, dyslexia,
  hearing access, and multilingual learning needs.

These are pilot targets, not measured outcomes. We will publish results after
mentor review and user testing.

## Drawbacks and safeguards

- Vision analysis can misunderstand a slide. The interface labels uncertainty and
  avoids inventing content when analysis fails.
- AWS analysis adds latency and cost. We sample the newest frame and discard it
  after analysis.
- Remote analysis creates privacy risk. Capture requires visible consent, and the
  service stores no raw frames or recordings.
- AR cannot represent every lesson. Every AR interaction has a text and keyboard
  equivalent.
- Accessibility needs differ. Students control their mode, and the product never
  diagnoses disability or infers attention.
- Canvas and institutional deployment require approval. The hackathon demo uses a
  temporary session and approved test materials.

## Five-minute demo

1. Show a dense biology slide and name the one-format classroom problem.
2. Instructor clicks Start and approves screen sharing.
3. Two students join the same session and select different modes.
4. Change the shared content. Focus, Read, Hear, captions, and AR update together.
5. Ask a grounded class question and show a cited Bedrock response.
6. End with the privacy boundary, pilot targets, and camera-based lab roadmap.

## Call to action

Help us test AccessLens with **[number]** students and **[number]** instructors.
We need design partners from disability services, teaching centers, and classrooms.
The next milestone is a consented AWS screen-analysis pilot with measured latency,
accuracy, accessibility, and student control.

## Evidence and references

- [RAND: AI Use in Schools Is Quickly Increasing but Guidance Lags Behind](https://www.rand.org/pubs/research_reports/RRA4180-1.html)
- [UNESCO AI Competency Framework for Teachers](https://unesdoc.unesco.org/ark:/48223/pf0000391104)
- [University of Utah Center for Disability & Access](https://disability.utah.edu/)
- [Vanderbilt Peabody: AI in the Classroom](https://blog.peabody.vanderbilt.edu/the-peabody-blog/understanding-the-future-of-ai-in-the-classroom)
- [Implemented feature inventory](IMPLEMENTED_FEATURES.md)
