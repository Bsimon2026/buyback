// Restructures the valuation flow in public/index.html:
//   device -> mobile number (+ first price) -> questions in 3 pages -> exact price -> details
// Run: node scripts/build-flow.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html');
let s = fs.readFileSync(file, 'utf8').split(String.fromCharCode(13)).join('');
const before = s.length;

const CRUMBS = {
  select: '<span class="on">01 Device</span><span>02 Number</span><span>03 Condition</span><span>04 Price</span><span>05 Details</span>',
  contact: '<span>01 Device</span><span class="on">02 Number</span><span>03 Condition</span><span>04 Price</span><span>05 Details</span>',
  condition: '<span>01 Device</span><span>02 Number</span><span class="on">03 Condition</span><span>04 Price</span><span>05 Details</span>',
  price: '<span>01 Device</span><span>02 Number</span><span>03 Condition</span><span class="on">04 Price</span><span>05 Details</span>',
  details: '<span>01 Device</span><span>02 Number</span><span>03 Condition</span><span>04 Price</span><span class="on">05 Details</span>',
};

// ---- 1. crumbs: five steps now ----
const crumbReplace = {
  select: '<div class="steps-crumb"><span class="on">01 Device</span><span>02 Condition</span><span>03 Details</span><span>04 Price</span></div>',
  condition: '<div class="steps-crumb"><span>01 Device</span><span class="on">02 Condition</span><span>03 Details</span><span>04 Price</span></div>',
  details: '<div class="steps-crumb"><span>01 Device</span><span>02 Condition</span><span class="on">03 Details</span><span>04 Price</span></div>',
  price: '<div class="steps-crumb"><span>01 Device</span><span>02 Condition</span><span>03 Details</span><span class="on">04 Price</span></div>',
};
for (const [key, old] of Object.entries(crumbReplace)) {
  if (!s.includes(old)) throw new Error('crumb not found: ' + key);
  s = s.replace(old, `<div class="steps-crumb">${CRUMBS[key]}</div>`);
}

// ---- 2. the device photo panel on the select screen ----
const estAside = `      <aside>
        <div class="est">
          <span class="lab">Estimated buyback</span>
          <div class="amount" id="estAmount1">—</div>
          <div class="sub" id="estSub1">Select your device to see a price</div>
        </div>
      </aside>`;
const shotAside = `      <aside>
        <div class="model-shot">
          <img id="modelShot" src="/assets/img/iphone15.jpg" alt="">
          <span class="shot-note">Representative model</span>
        </div>
        <div class="est" style="margin-top:14px">
          <span class="lab">Estimated buyback</span>
          <div class="amount" id="estAmount1">—</div>
          <div class="sub" id="estSub1">Select your device to see a price</div>
        </div>
      </aside>`;
if (s.includes(estAside)) s = s.replace(estAside, shotAside);

// ---- 3. the mobile-number screen, between device and condition ----
const contactScreen = `
<div id="scr-contact" class="flow hidden">
  <div class="wrap">
    <div class="flow-top">
      <div class="steps-crumb">${CRUMBS.contact}</div>
      <button class="btn btn-out btn-sm" onclick="backToSelect()">Change device</button>
    </div>
    <div class="flow-grid">
      <div class="panel">
        <h2>Where should we send the price?</h2>
        <p class="panel-sub">We show a first estimate straight away, then ask a few short questions to narrow it to
          the exact value. No address, no ID, no obligation.</p>
        <div style="margin-top:22px;max-width:420px">
          <label class="field"><span class="lab">Mobile number</span>
            <input id="cPhone" inputmode="tel" placeholder="+971 50 123 4567" autocomplete="tel"></label>
          <div class="flow-actions" style="margin-top:14px">
            <button class="btn" id="cPhoneBtn" onclick="submitPhone()">Show my first price</button>
          </div>
          <div id="cErr" class="err"></div>
        </div>

        <div id="firstPrice" class="first-price hidden">
          <div class="fp-k">First estimate — ${'{'}device{'}'}</div>
          <div class="fp-v" id="fpRange">—</div>
          <p class="fp-note">That is the top of the range, for a device in perfect condition with everything
            included. The next few questions bring it to <b>your exact value</b> — about 40 seconds.</p>
          <button class="btn" onclick="openCondition()">Answer a few questions
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <aside>
        <div class="est">
          <span class="lab">Why the number first?</span>
          <div class="sub" style="margin-top:8px">So the price you see is yours — we can call you back about it, and
            you never have to repeat yourself at the door.</div>
          <div class="note">We do not send marketing messages. Ever.</div>
        </div>
      </aside>
    </div>
  </div>
</div>

<div id="scr-condition" class="flow hidden">`;
if (!s.includes('id="scr-contact"')) {
  s = s.replace('\n<div id="scr-condition" class="flow hidden">', contactScreen);
}

// ---- 4. condition screen: three pages ----
const condOld = `        <p class="panel-sub">Answer honestly — the inspector scores the same points in person, and that check sets the final value at your visit.</p>
        <div id="questionBody"></div>
        <div class="flow-actions">
          <button class="btn btn-out" onclick="backToSelect()">Back</button>
          <button class="btn" id="toDetails" disabled onclick="go('details')">Continue</button>
        </div>`;
const condNew = `        <p class="panel-sub">Answer honestly — the inspector scores the same points in person, and that check sets the final value at your visit.</p>
        <div class="qpager">
          <span id="qStep" class="qpager-k">Step 1 of 3</span>
          <span class="qpager-bar"><i id="qBar"></i></span>
        </div>
        <div id="questionBody"></div>
        <div class="flow-actions">
          <button class="btn btn-out" id="qBack" onclick="prevQuestionPage()">Back</button>
          <button class="btn" id="toDetails" disabled onclick="nextQuestionPage()">Next</button>
        </div>`;
if (!s.includes('id="qStep"')) {
  if (!s.includes(condOld)) throw new Error('condition block not found');
  s = s.replace(condOld, condNew);
}

// ---- 5. price screen now comes BEFORE details ----
const priceBack = '<button class="btn btn-out btn-sm" onclick="go(\'details\')">Edit details</button>';
if (s.includes(priceBack)) s = s.replace(priceBack, '<button class="btn btn-out btn-sm" onclick="go(\'condition\')">Edit answers</button>');
const bookBtn = '<button class="btn" id="bookBtn" onclick="bookPickup()">Book free pickup</button>';
if (s.includes(bookBtn)) s = s.replace(bookBtn, '<button class="btn" id="bookBtn" onclick="go(\'details\')">Book free pickup</button>');

// ---- 6. details screen: the number is already known, and this is now the last step ----
const phoneField = '<label class="field"><span class="lab">Mobile *</span><input id="fPhone" inputmode="tel" placeholder="+971 50 123 4567"></label>';
if (s.includes(phoneField)) {
  s = s.replace(phoneField,
    '<label class="field"><span class="lab">Mobile (from step 2)</span><input id="fPhone" readonly style="background:var(--paper-2)"></label>');
}
const detBack = '<button class="btn btn-out" onclick="go(\'condition\')">Back</button>\n            <button class="btn" id="submitBtn" onclick="captureDetails()">Show my price</button>';
if (s.includes(detBack)) {
  s = s.replace(detBack,
    '<button class="btn btn-out" onclick="go(\'price\')">Back</button>\n            <button class="btn" id="submitBtn" onclick="confirmBooking()">Confirm pickup</button>');
}
const detAside = `          <span class="lab">Next</span>
          <div class="amount" style="font-size:20px">Your price</div>
          <div class="sub">Shown the moment these details are in.</div>`;
if (s.includes(detAside)) {
  s = s.replace(detAside, `          <span class="lab">Last step</span>
          <div class="amount" style="font-size:20px">Confirm</div>
          <div class="sub">We reserve the slot and the price you were shown.</div>`);
}

fs.writeFileSync(file, s);
console.log(`index.html ${before} -> ${s.length} bytes`);
for (const id of ['scr-contact', 'cPhone', 'firstPrice', 'qStep', 'qBar', 'modelShot']) {
  if (!s.includes(`id="${id}"`)) throw new Error('missing ' + id);
}
console.log('flow markup verified');
