<div align="center">

<img src="assets/banner.gif" alt="AccessLens — 1st Place, Minds & Machines: AI in Education Hackathon 2026. A real-time lecture companion by Team Mind-Stone." width="100%" />

<br /><br />

<img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/amazonwebservices/amazonwebservices-original-wordmark.svg" alt="Amazon Web Services" height="70" />

[![1st Place](https://img.shields.io/badge/1st_Place-Minds_%26_Machines_2026-F2FB5B?style=for-the-badge&labelColor=16160e)](https://rai.utah.edu/events/hackathon/)
[![University of Utah](https://img.shields.io/badge/One--U_Responsible_AI-University_of_Utah-16160e?style=for-the-badge)](https://rai.utah.edu/)
[![Live on AWS](https://img.shields.io/badge/Live_on-AWS-232F3E?style=for-the-badge&logo=amazonaws&logoColor=FF9900)](#accesslens-on-aws)

**A real-time lecture companion.** Keep every student synchronized with the instructor's live screen, rendered in a form they can actually access.

</div>

---
</div>

### Thank you to the sponsors and hosts

<div align="center">

<img src="assets/sponsors.png" alt="Event sponsors: AWS, The Attic AI, Nucleus, Waystar, and AI Utah." width="100%" />

</div>

---

## The one-format classroom

An instructor presents a slide, diagram, video, website, or simulation in **one form**. Students who cannot see, hear, parse, translate, or sustain attention on that form lose the lesson as the class moves on.

AccessLens is a browser extension that keeps every student in sync with the instructor's live screen and renders the same lesson in a form each student can access.

---

## How it works

The instructor **explicitly** starts a session and picks a tab, window, or screen to share. The instructor extension recognizes the current approved asset and emits small semantic events (slide ID, highlighted region, pointer position, caption segment, sequence number) through a temporary AWS session. Student extensions follow automatically and render each event through the mode the student chose.

```text
Instructor opens the extension
        -> starts a session
        -> picks a tab / window / screen
        -> advances an approved deck
        -> extension emits slide / region / pointer events

Student opens the extension
        -> joins with a code
        -> chooses an access mode once
        -> automatically follows the instructor
        -> reads and listens at their own pace
```

### Access modes

| Mode | What the student gets |
|:---|:---|
| **Screen readers** | Every reviewed description is plain text that VoiceOver, NVDA, JAWS, and ChromeVox read as the lesson moves. No separate audio mode. |
| **Focus** | One region or relationship at a time. |
| **Read** | Structured text, read-aloud, or approved language support. |
| **Dyslexic** | Student-controlled spacing, line length, and dyslexic-friendly typography for the same reviewed text. |
| **Locate** | Spatial directions or haptics. |
| **Explore in AR** | A synchronized spatial model of the current concept, with keyboard, touch, voice, and non-immersive equivalents. |

Students do not need a camera for the core experience. Camera recognition is a future, opt-in fallback for content that cannot be screen-shared, such as lab equipment, specimens, studio work, and physical demonstrations.

---

## AccessLens on AWS

Six CDK stacks, one account, `us-east-1`. Every model call and every upload goes through Lambda, never from the browser. No AWS keys anywhere in the client.

<div align="center">

<img src="assets/architecture.png" alt="AccessLens AWS architecture: instructor extension feeds a Live Lesson stack (Captions Lambda, Transcribe Streaming, API Gateway WebSocket, Relay Lambda, DynamoDB) that fans out to student extensions; an Accessibility stack (Orb catch-up recap on Bedrock Claude, Polly, Translate); an Authoring stack (HTTP API, Step Functions, S3 Vectors); a Distribution stack (CloudFront + S3); and a Course Media upload pipeline (API Lambda, S3, Worker Lambda, Transcribe job, Bedrock alt text, EventBridge, DynamoDB)." width="100%" />

</div>

| Stage | Stack | What runs |
|:---|:---|:---|
| **Live** | `AccessLensLiveSession` | API Gateway WebSocket, Relay Lambda validates every event, Captions via Amazon Transcribe streaming, DynamoDB sessions with TTL |
| **Accessibility** | `AccessLensAccessibility` + `OrbExplain` | Catch-up recap and explain-what-I-missed on **Claude via Amazon Bedrock**, spoken and translated with **Amazon Polly** and **Amazon Translate** |
| **Before class** | `AccessLensAuthoring` | Google sign-in HTTP API, Step Functions library builders, **S3 Vectors** course library |
| **Delivery** | `AccessLensDistribution` | CloudFront + S3 for the landing page, extension zip, hosted app, and reviewed packs |
| **On upload** | `AccessLensCourseMedia` | Presigned S3 upload, container Worker Lambda (LibreOffice, poppler, ffmpeg), Transcribe captions, Bedrock alt text, EventBridge finish, DynamoDB |
| **Deploy** | GitHub OIDC | GitHub Actions to CloudFormation/CDK, CodeBuild builds the worker image to ECR |

<div align="center">

![Amazon Bedrock](https://img.shields.io/badge/Amazon_Bedrock-232F3E?style=flat-square&logo=amazonaws&logoColor=FF9900)
![Amazon Transcribe](https://img.shields.io/badge/Amazon_Transcribe-232F3E?style=flat-square&logo=amazonaws&logoColor=FF9900)
![Amazon Polly](https://img.shields.io/badge/Amazon_Polly-232F3E?style=flat-square&logo=amazonaws&logoColor=FF9900)
![Amazon Translate](https://img.shields.io/badge/Amazon_Translate-232F3E?style=flat-square&logo=amazonaws&logoColor=FF9900)
![AWS Lambda](https://img.shields.io/badge/AWS_Lambda-FF9900?style=flat-square&logo=awslambda&logoColor=white)
![API Gateway](https://img.shields.io/badge/API_Gateway-FF4F8B?style=flat-square&logo=amazonapigateway&logoColor=white)
![DynamoDB](https://img.shields.io/badge/DynamoDB-4053D6?style=flat-square&logo=amazondynamodb&logoColor=white)
![S3](https://img.shields.io/badge/S3_Vectors-569A31?style=flat-square&logo=amazons3&logoColor=white)
![CloudFront](https://img.shields.io/badge/CloudFront-232F3E?style=flat-square&logo=amazoncloudfront&logoColor=FF9900)
![Step Functions](https://img.shields.io/badge/Step_Functions-FF4F8B?style=flat-square&logo=awsstepfunctions&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)

</div>

---

## Built responsibly, on purpose

The MVP uses checked-in mock content. It does **not** scrape Canvas, silently capture a screen, store recordings, infer disability or attention, or grade students. Captions are off by default and turn on only beside a consent notice.

---

## Team Mind-Stone

Built at the **Minds & Machines: AI in Education Hackathon**, One-U Responsible AI Initiative, University of Utah, September 2026.

**Anurup Kumar · Jacob Erard · Kunj Rathod · Omar Rizwan · Prachi Aswani**

<div align="center">

<img src="assets/team.png" alt="AccessLens closing slide: the ACCESSLENS wordmark, the tagline A real-time lecture companion, and Team Mind-Stone members Anurup Kumar, Jacob Erard, Kunj Rathod, Omar Rizwan, and Prachi Aswani." width="100%" />

<div align="center">

**AccessLens** · 1st Place, Minds & Machines: AI in Education Hackathon 2026 · Team Mind-Stone

*Powered by AWS and Amazon Bedrock.*

</div>
