// Builds public/sites/sellformoney/index.html from the main page: keeps every element the
// quote flow needs, replaces the marketing with a money-only, differently-laid-out page.
//   node scripts/build-sellformoney-page.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const between = (startMarker, endMarker) => {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker);
  if (a < 0 || b < 0 || b <= a) throw new Error(`markers not found: ${startMarker} / ${endMarker}`);
  return src.slice(a, b);
};

const tape = between('<!-- ============ LIVE PRICE TAPE', '<!-- ============ IMPACT');
const prices = between('<!-- ============ PRICES', '<!-- ============ CLAIMS')
  .replace('<span class="snum">04 &mdash; Price list</span>', '<span class="snum">02 &mdash; Price list</span>');
const cash = between('<!-- ============ CASH', '<!-- ============ BRANCHES')
  .replace('Cash for the device. A certificate for the data.',
           'Cash for the device, counted out before we leave.')
  .replace('Bank transfer if you prefer it. Either way it is logged, receipted and signed &mdash; and the data\n          treatment is chosen by you, not assumed by us.',
           'Bank transfer if you prefer it. Either way it is receipted and signed, and the payment is logged against your order.')
  .replace('<span class="snum">Paid on collection</span>', '<span class="snum">03 &mdash; Paid on collection</span>');
const branches = between('<!-- ============ BRANCHES', '<!-- ============ FAQ')
  .replace('<span class="snum">06 &mdash; Coverage</span>', '<span class="snum">04 &mdash; Pickup and counters</span>');
const track = between('<!-- ============ TRACK', '<!-- ============ FLOW');
const tail = src.slice(src.indexOf('<!-- ============ FLOW ============ -->'));

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sell your phone for cash in Dubai — free pickup, paid on the spot</title>
<link rel="canonical" href="https://sellformoney.com/">
<meta name="description" content="Get a real price for your phone or laptop in under a minute. Free pickup across the UAE, cash or bank transfer on collection. No fees, no commission, reject the offer for free.">
<link rel="stylesheet" href="/assets/styles.css">
<link rel="stylesheet" href="/assets/customer.css">
<link rel="stylesheet" href="/assets/home.css">
<link rel="stylesheet" href="/assets/sell.css">
<noscript><style>
  .reveal,.eyebrow,.hero-sub,.hero-acts,.hero-facts,.vcard{opacity:1!important;transform:none!important}
  .fq .fq-body{grid-template-rows:1fr!important}
</style></noscript>
</head>
<body class="home sfm-sell">

<header class="hdr sfm-hdr" id="hdr">
  <div class="hdr-in">
    <a class="sfm-brand" href="#" onclick="go('home');return false" aria-label="sell for money — home">
      <img src="/assets/img/sfm-mark.svg" alt="">
      <b>sell <em>for</em> money</b>
    </a>
    <nav class="nvl" aria-label="Sections">
      <a href="#prices">Prices</a>
      <a href="#how">How it works</a>
      <a href="#branches">Pickup</a>
      <a href="#track">Track</a>
    </nav>
    <div class="hdr-r">
      <div class="hdr-tel"><small>Call or WhatsApp</small><span id="navPhone">+971 50 000 0000</span></div>
      <button class="cta cta-sm" onclick="scrollToQuote()" data-magnet>Get my price</button>
    </div>
  </div>
</header>

<section id="scr-home">

  <!-- ============ HERO (centred) ============ -->
  <section class="sfm-hero">
    <div class="wrap">
      <div class="eyebrow" style="justify-content:center">
        <span class="pulse" aria-hidden="true"></span>
        <span>Paying cash for phones &amp; laptops<span class="ebr-more"> &middot; Dubai / Abu Dhabi / Sharjah</span></span>
      </div>
      <h1>Sell your phone.<br>Get paid <em>today</em>.</h1>
      <p class="sub">A real price in under a minute, collected from your door, and paid before the driver leaves.
        No fees, no commission, no haggling at the last second.</p>
      <div class="sfm-facts">
        <span>Price held 48 hours</span>
        <span>Cash or bank transfer</span>
        <span>Reject free</span>
      </div>

      <div class="sfm-vwrap">
        <div class="vcard" id="quote">
          <div class="vcard-top">
            <span class="k">What are you selling?</span>
            <div class="switch" id="hqTabs">
              <button class="on" data-cat="mobile">Phone</button>
              <button data-cat="laptop">Laptop</button>
            </div>
          </div>
          <div class="vcard-body">
            <label class="fld"><span>Brand</span>
              <select id="hqBrand"><option>Loading&hellip;</option></select></label>
            <label class="fld"><span>Model</span>
              <select id="hqModel"><option>Choose a model</option></select></label>
            <label class="fld hidden" id="hqVariantWrap"><span>Storage</span>
              <select id="hqVariant" class="hidden"></select></label>
            <button class="cta cta-wide" id="hqGo" onclick="heroQuote()">Get my price</button>
            <p class="vcard-note">A few details first, then the number. Collection is free and you can say no at the door.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

${tape}

  <!-- ============ HOW IT WORKS ============ -->
  <section class="sfm-steps" id="how">
    <div class="wrap">
      <h2>Three steps, about an hour of your day.</h2>
      <div class="sfm-grid">
        <div class="sfm-step">
          <span class="n">01</span>
          <h3>Tell us what you have</h3>
          <p>Brand, model, storage, then a short list of condition questions. One minute, on your phone, no account
            and no obligation.</p>
        </div>
        <div class="sfm-step">
          <span class="n">02</span>
          <h3>We collect or you drop in</h3>
          <p>Free pickup at a time you choose, seven days a week — or walk into one of our counters and skip the
            queue.</p>
        </div>
        <div class="sfm-step">
          <span class="n">03</span>
          <h3>Paid before we leave</h3>
          <p>A ten-minute check against the answers you gave, a firm figure, then cash in hand or a transfer you
            can see land.</p>
        </div>
      </div>
    </div>
  </section>

${prices}

${cash}

${branches}

  <!-- ============ FAQ ============ -->
  <section class="sec sec-last">
    <div class="wrap">
      <div class="shead reveal">
        <span class="snum">05 &mdash; Questions</span>
        <h2>What people ask before booking.</h2>
      </div>
      <div class="faqs">
        <div class="fq">
          <button type="button" aria-expanded="false"><span>Is the price I see online what I get paid?</span><i class="ic" aria-hidden="true"></i></button>
          <div class="fq-body"><div><p>It is a firm estimate based on your answers, and it is held for 48 hours. The
            exact figure is confirmed when we inspect the device at your visit — cosmetic condition, battery health
            and function are checked in person. If it matches what you told us, the offer lands in your range.</p></div></div>
        </div>
        <div class="fq">
          <button type="button" aria-expanded="false"><span>What if the offer is lower than I expected?</span><i class="ic" aria-hidden="true"></i></button>
          <div class="fq-body"><div><p>You say no and keep the device. Refusing costs nothing — there is no fee, no
            cancellation charge, and no pressure at the door.</p></div></div>
        </div>
        <div class="fq">
          <button type="button" aria-expanded="false"><span>How do you pay?</span><i class="ic" aria-hidden="true"></i></button>
          <div class="fq-body"><div><p>Cash on collection, or a bank transfer to your account if you prefer. Either way
            you get a receipt for the sale showing the amount, the method and the device identifiers.</p></div></div>
        </div>
        <div class="fq">
          <button type="button" aria-expanded="false"><span>What do you need from me?</span><i class="ic" aria-hidden="true"></i></button>
          <div class="fq-body"><div><p>Emirates ID or passport, the device itself, and its IMEI. Box and invoice help
            the offer but are not required. Sign out of your Apple or Google account before handover.</p></div></div>
        </div>
        <div class="fq">
          <button type="button" aria-expanded="false"><span>Is pickup really free?</span><i class="ic" aria-hidden="true"></i></button>
          <div class="fq-body"><div><p>Yes. Collection and inspection cost nothing, seven days a week, and there is no
            obligation to sell once you hear the figure.</p></div></div>
        </div>
      </div>
    </div>
  </section>

${track}

</section>

${tail}`;

const out = path.join(root, 'public', 'sites', 'sellformoney', 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log('written', out, page.length, 'bytes');
