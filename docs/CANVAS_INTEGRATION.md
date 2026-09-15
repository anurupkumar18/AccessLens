# Canvas and Institutional Integration Boundary

## Hackathon decision

Production Canvas integration is not required for the AccessLens MVP. The extension
uses a temporary session code and checked-in mock course assets so institutional
access cannot block the demo.

The MVP must not scrape Canvas pages, collect personal access tokens, inspect
assignments, or imply that it is institutionally installed.

## Future approved path

If a university approves production integration, LTI 1.3 or university SSO could:

- identify the course and instructor/student role;
- launch the extension onboarding flow;
- distribute a reviewed Access Pack identifier;
- create a course-scoped live-session capability; and
- show the AccessLens launch link inside a module.

The extension remains the experience surface. Canvas supplies approved identity and
course context; it is not scraped as a hidden content source.

## Excluded data

Even after approval, the default integration excludes:

- assignments and submissions;
- quizzes, exams, and answer keys;
- discussions and private messages;
- gradebook data; and
- disability or accommodation records.

## Institutional questions

Before a pilot, the team needs written answers about:

- extension deployment and managed-browser policy;
- LTI developer-key ownership;
- allowed course assets and copyright;
- screen-capture and classroom-recording policy;
- retention and logging;
- accessibility review ownership;
- incident response; and
- support responsibilities.

No engineering shortcut replaces those decisions.
