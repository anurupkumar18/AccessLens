(function(){function e(e){return{provenance:`generated`,value:e,notice:`AI-generated. Not reviewed by your instructor. May be wrong.`}}function t(e){return`${e.notice} ${e.value}`}var n=new Set([`svg`,`g`,`path`,`circle`,`ellipse`,`rect`,`line`,`polyline`,`polygon`,`text`,`tspan`,`defs`,`marker`,`title`,`desc`,`animate`,`animateTransform`]);function r(e){if(typeof DOMParser>`u`)return;let t=new DOMParser().parseFromString(e,`image/svg+xml`);if(t.querySelector(`parsererror`))return;let r=t.documentElement;if(!r||r.tagName.toLowerCase()!==`svg`)return;let i=e=>{let t=e.tagName.toLowerCase();if(!n.has(t))return;let r=document.createElementNS(`http://www.w3.org/2000/svg`,t);for(let t of Array.from(e.attributes)){let e=t.name.toLowerCase();e.startsWith(`on`)||e.startsWith(`xlink:`)||e===`href`||/url\(|javascript:|data:/i.test(t.value)||r.setAttribute(t.name,t.value)}for(let t of Array.from(e.children)){let e=i(t);e&&r.appendChild(e)}return e.children.length===0&&e.textContent&&(r.textContent=e.textContent),r},a=i(r);if(a)return a.setAttribute(`role`,`img`),a.outerHTML}var i=class extends Error{};async function a(t,n,a){if(!t)throw new i(`No explanation service is configured. Set the orb endpoint in AccessLens settings.`);let o=await fetch(t,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify(n),signal:a});if(!o.ok)throw new i(`The explanation service returned ${o.status}.`);let s=await o.json(),c=typeof s.text==`string`?s.text.trim():``;if(!c)throw new i(`The explanation service returned nothing usable.`);return e({text:c,svg:typeof s.svg==`string`?r(s.svg):void 0})}var o=`
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

.orb {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  width: 56px; height: 56px; border-radius: 50%; border: 2px solid #fff;
  background: radial-gradient(circle at 32% 30%, #6aa3f0, #2f5fa8 62%, #24487e);
  box-shadow: 0 6px 20px rgba(0,0,0,.35); cursor: pointer; color: #fff;
  font-size: 22px; line-height: 1; display: grid; place-items: center;
  transition: transform .18s ease, box-shadow .18s ease;
}
.orb:hover { transform: scale(1.06); }
.orb:focus-visible { outline: 3px solid #ffb703; outline-offset: 3px; }
.orb[aria-expanded="true"] { transform: scale(.92); }

.panel {
  position: fixed; right: 20px; bottom: 88px; z-index: 2147483647;
  width: min(420px, calc(100vw - 40px)); max-height: min(70vh, 620px);
  overflow-y: auto; background: #fff; color: #14181f;
  border: 1px solid #d7dce5; border-radius: 14px;
  box-shadow: 0 14px 44px rgba(0,0,0,.28); padding: 16px;
}
@media (prefers-color-scheme: dark) {
  .panel { background: #1a1f26; color: #e8ecf2; border-color: #2b323c; }
  .actions button { background: #222933; color: #e8ecf2; border-color: #39424e; }
  .notice { background: #2e2617; border-color: #c9962f; }
  .result { background: #151a21; border-color: #2b323c; }
}
.panel[hidden] { display: none; }

h2 { margin: 0 0 2px; font-size: 1rem; }
.sub { margin: 0 0 12px; font-size: .8rem; opacity: .75; }

.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.actions button {
  flex: 1 1 auto; padding: 9px 12px; font-size: .86rem; font-weight: 600;
  border: 1px solid #c8cfda; border-radius: 9px; background: #f3f6fa;
  color: inherit; cursor: pointer;
}
.actions button:hover:not(:disabled) { border-color: #2f5fa8; }
.actions button:focus-visible { outline: 3px solid #ffb703; outline-offset: 2px; }
.actions button:disabled { opacity: .5; cursor: not-allowed; }

.notice {
  display: flex; gap: 8px; align-items: flex-start;
  background: #fff6e6; border: 1px solid #e0a63c; border-radius: 9px;
  padding: 9px 11px; font-size: .8rem; margin-bottom: 10px;
}
.notice strong { white-space: nowrap; }

.result {
  border: 1px solid #e2e7ef; border-radius: 9px; padding: 12px;
  background: #fafbfd; font-size: .92rem; white-space: pre-wrap;
}
.result svg { max-width: 100%; height: auto; display: block; margin-top: 10px; }
.status { font-size: .82rem; opacity: .8; margin: 8px 0 0; }
.close {
  position: absolute; top: 10px; right: 12px; background: none; border: none;
  font-size: 18px; cursor: pointer; color: inherit; padding: 4px 6px; border-radius: 6px;
}
.close:focus-visible { outline: 3px solid #ffb703; }
@media (prefers-reduced-motion: reduce) {
  .orb, .actions button { transition: none !important; }
  .result svg animate, .result svg animateTransform { display: none; }
}
`;function s(e,t){let n=document.createElement(`div`);n.setAttribute(`data-accesslens-orb`,``);let r=n.attachShadow({mode:`open`}),i=document.createElement(`style`);i.textContent=o,r.appendChild(i);let a=document.createElement(`button`);a.className=`orb`,a.type=`button`,a.textContent=`◐`,a.setAttribute(`aria-label`,`Open AccessLens explainer`),a.setAttribute(`aria-expanded`,`false`);let s=document.createElement(`div`);s.className=`panel`,s.setAttribute(`role`,`dialog`),s.setAttribute(`aria-modal`,`false`),s.setAttribute(`aria-label`,`AccessLens explainer`),s.hidden=!0,s.innerHTML=`
    <button class="close" type="button" aria-label="Close explainer">×</button>
    <h2>Explain this page</h2>
    <p class="sub">Select text first to explain just that part.</p>
    <div class="actions">
      <button type="button" data-mode="explain">Explain</button>
      <button type="button" data-mode="simplify">Simpler words</button>
      <button type="button" data-mode="diagram">Diagram it</button>
    </div>
    <div class="actions">
      <button type="button" data-speak>Read aloud</button>
      <button type="button" data-stop hidden>Stop reading</button>
    </div>
    <p class="status" role="status" aria-live="polite"></p>
    <div class="result" hidden></div>
  `,r.append(a,s),document.documentElement.appendChild(n);let c=s.querySelector(`.status`),l=s.querySelector(`.result`),u=s.querySelector(`[data-speak]`),d=s.querySelector(`[data-stop]`),f=s.querySelector(`.close`);u.disabled=!t,t||(u.title=`This browser has no speech voices available.`);let p=!1;function m(){return Array.from(s.querySelectorAll(`button:not([hidden]):not(:disabled)`))}function h(e){p=e,s.hidden=!e,a.setAttribute(`aria-expanded`,String(e)),a.setAttribute(`aria-label`,e?`Close AccessLens explainer`:`Open AccessLens explainer`),e?(s.querySelector(`[data-mode]`)??m()[0])?.focus():a.focus()}return a.addEventListener(`click`,()=>p?e.onClose():h(!0)),f.addEventListener(`click`,()=>e.onClose()),s.addEventListener(`click`,t=>{let n=t.target,r=n.dataset?.mode;r===`explain`||r===`simplify`||r===`diagram`?e.onAction(r):n.hasAttribute(`data-speak`)?e.onSpeak():n.hasAttribute(`data-stop`)&&e.onStopSpeaking()}),r.addEventListener(`keydown`,t=>{let n=t.key;if(n===`Escape`&&p){t.preventDefault(),e.onClose();return}if(n!==`Tab`||!p)return;let i=m();if(i.length===0)return;let a=r.activeElement,o=a?i.indexOf(a):-1,s=t.shiftKey,c=s?o-1:o+1;(c<0||c>=i.length)&&(t.preventDefault(),i[s?i.length-1:0].focus())}),{root:n,get isOpen(){return p},open:()=>h(!0),close:()=>h(!1),setBusy(e,t){c.textContent=e?t??`Working…`:``,s.querySelectorAll(`[data-mode]`).forEach(t=>t.disabled=e)},showResult(e,t,n){l.hidden=!1,l.textContent=``;let r=document.createElement(`div`);r.className=`notice`,r.innerHTML=`<strong>Heads up:</strong><span></span>`,r.querySelector(`span`).textContent=e;let i=document.createElement(`div`);if(i.textContent=t,l.append(r,i),n){let e=document.createElement(`div`);e.innerHTML=n,l.appendChild(e)}c.textContent=`Ready.`},showError(e){l.hidden=!1,l.textContent=e,c.textContent=``},setSpeaking(e){d.hidden=!e,u.hidden=e},destroy(){n.remove()}}}var c=6e3,l=new Set([`SCRIPT`,`STYLE`,`NOSCRIPT`,`IFRAME`,`SVG`,`CANVAS`,`INPUT`,`TEXTAREA`,`SELECT`,`BUTTON`,`NAV`,`FOOTER`]);function u(e){let t=window.getComputedStyle(e);if(t.display===`none`||t.visibility===`hidden`||t.opacity===`0`)return!1;let n=e.getBoundingClientRect();return n.width>0&&n.height>0}function d(e,t,n){if(!(n.left<=0))for(let r of Array.from(e.children)){if(n.left<=0)return;if(!l.has(r.tagName)&&r.getAttribute(`aria-hidden`)!==`true`&&u(r)){if(r.children.length===0){let e=(r.textContent??``).trim().replace(/\s+/g,` `);e.length>1&&(t.push(e),n.left-=e.length)}else d(r,t,n)}}}function f(){let e=(window.getSelection()?.toString()??``).trim().replace(/\s+/g,` `),t=document.querySelector(`main, [role="main"], article`)??document.body,n=[];return d(t,n,{left:c}),{title:document.title,url:`${location.origin}${location.pathname}`,selection:e,text:(e||n.join(`
`)).slice(0,c),fromSelection:e.length>0}}function p(){let e=typeof window<`u`?window.speechSynthesis:void 0;return{get available(){return!!e},get speaking(){return!!e?.speaking},speak(t){if(!e||!t.trim())return;e.cancel();let n=new SpeechSynthesisUtterance(t);n.rate=.95,n.lang=document.documentElement.lang||`en`,e.speak(n)},stop(){e?.cancel()}}}var m=`data-accesslens-orb-mounted`,h={explain:`Explaining this page…`,simplify:`Putting this in simpler words…`,diagram:`Drawing a diagram…`},g=`https://ax7d57zgdz6yrxumcizsorlneq0feqkt.lambda-url.us-east-1.on.aws/`;async function _(){try{let e=typeof chrome<`u`?chrome?.storage?.local:void 0;if(e){let t=await e.get(`orbEndpoint`);if(typeof t.orbEndpoint==`string`&&t.orbEndpoint)return t.orbEndpoint}}catch{}return g}function v(){if(document.documentElement.hasAttribute(m))return;document.documentElement.setAttribute(m,``);let e=p(),n=``,r,o,c=async e=>{r?.abort(),r=new AbortController,o.setBusy(!0,h[e]);try{let i=f();if(!i.text){o.showError(`There is no readable text on this page to explain.`);return}let s=await a(await _(),{mode:e,title:i.title,url:i.url,text:i.text},r.signal);n=t({...s,value:s.value.text}),o.showResult(s.notice,s.value.text,s.value.svg)}catch(e){if(e?.name===`AbortError`)return;o.showError(e instanceof i?e.message:`Could not reach the explanation service.`)}finally{o.setBusy(!1)}};o=s({onAction:e=>void c(e),onSpeak:()=>{let t=f();e.speak(n||t.text.slice(0,4e3)),o.setSpeaking(!0)},onStopSpeaking:()=>{e.stop(),o.setSpeaking(!1)},onClose:()=>{e.stop(),o.setSpeaking(!1),o.close()}},e.available),typeof chrome<`u`&&chrome?.runtime?.onMessage?.addListener(e=>{e?.type===`accesslens:toggle-orb`&&(o.isOpen?o.close():o.open())})}document.readyState===`loading`?document.addEventListener(`DOMContentLoaded`,v,{once:!0}):v()})();