/* Demo API — runs the customer site with no server.
 *
 * The site normally talks to a Node backend (quotes, orders, tracking). For the Vercel
 * preview there is no backend, so this file answers the same URLs in the browser:
 *   - config / catalog / questions come from demo-data.json, snapshotted from the live database
 *   - quotes are computed with the same arithmetic as src/pricing.js
 *   - bookings are stored in this browser only, and are clearly not real bookings
 *
 * The price maths lives in one function so the parity test can import this file directly
 * (scripts/verify-demo-parity.mjs) instead of re-implementing it.
 */
(function (root) {
  'use strict';

  var STEP_MAJOR = 10;        // AED — replaced by demo-data.json
  var RANGE_BP = 500;         // 5%
  var FLOOR_BP = 1500;        // 15% of base
  var CURRENCY = 'AED';
  var FACTOR = 100;           // minor units per major for the display currency
  var DATA = null;

  function roundToStep(minor) {
    var step = Math.max(1, Math.round(STEP_MAJOR || 1)) * FACTOR;
    return Math.round(minor / step) * step;
  }

  // condition adjustments round to a whole unit of the display currency (AED77, never AED76.80)
  function roundToUnit(minor) {
    return Math.round(minor / FACTOR) * FACTOR;
  }

  function fmt(minor) {
    var v = minor / FACTOR;
    var s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return (v < 0 ? '-' : '') + CURRENCY + s;
  }

  var GRADE_ORDER = ['A', 'B', 'C', 'D'];

  /** Mirrors valuate() in src/pricing.js. Inputs are already in the display currency. */
  function valuate(variant, questions, answers) {
    var baseMinor = variant.basePrice.minor;
    var delta = 0, worst = null, missing = [], adjustments = [];

    questions.forEach(function (q) {
      var chosen = answers[q.code];
      if (chosen === undefined || chosen === null || chosen === '') { missing.push(q.code); return; }
      var opt = null;
      for (var i = 0; i < q.options.length; i++) if (q.options[i].code === chosen) { opt = q.options[i]; break; }
      if (!opt) { var e = new Error('Invalid option "' + chosen + '" for question "' + q.code + '"'); e.status = 400; throw e; }
      var amount = opt.adj_kind === 'pct' ? roundToUnit(Math.round(baseMinor * (opt.adj_value / 10000))) : opt.adj_value;
      delta += amount;
      if (opt.grade && GRADE_ORDER.indexOf(opt.grade) > GRADE_ORDER.indexOf(worst || 'A')) worst = opt.grade;
      adjustments.push({
        question: q.code, questionLabel: q.label, section: q.section,
        option: opt.code, optionLabel: opt.label,
        deltaMinor: amount, delta: fmt(amount),
      });
    });

    var floorMinor = Math.round(baseMinor * (FLOOR_BP / 10000));
    var estimate = baseMinor + delta;
    if (estimate < floorMinor) estimate = floorMinor;
    estimate = roundToStep(estimate);

    var band = Math.round(estimate * (RANGE_BP / 10000));
    var low = roundToStep(estimate - band);
    var high = roundToStep(estimate + band);
    var floorRounded = roundToStep(floorMinor);
    if (low < floorRounded) low = floorRounded;
    if (low > estimate) low = estimate;

    return {
      device: { variantId: variant.id, brand: variant._brand, model: variant._model,
        variant: variant.variant, category: variant._category,
        label: variant._brand + ' ' + variant._model + ' ' + variant.variant },
      basePrice: { minor: baseMinor, currency: CURRENCY, formatted: fmt(baseMinor) },
      adjustments: adjustments,
      missingAnswers: missing,
      complete: missing.length === 0,
      delta: { minor: delta, currency: CURRENCY, formatted: fmt(delta) },
      estimate: { minor: estimate, currency: CURRENCY, formatted: fmt(estimate) },
      range: { low: { minor: low, currency: CURRENCY, formatted: fmt(low) },
        high: { minor: high, currency: CURRENCY, formatted: fmt(high) },
        text: fmt(low) + ' \u2013 ' + fmt(high) },
      grade: worst || 'A',
      currency: CURRENCY,
      disclaimer: 'Final price is confirmed after physical inspection.',
      demo: true,
    };
  }

  function flatVariants() {
    var out = [];
    (DATA.catalog.mobile || []).forEach(function (b) {
      b.models.forEach(function (m) {
        m.variants.forEach(function (v) {
          out.push(Object.assign({}, v, { _brand: b.name, _model: m.name, _category: 'mobile' }));
        });
      });
    });
    (DATA.catalog.laptop || []).forEach(function (b) {
      b.models.forEach(function (m) {
        m.variants.forEach(function (v) {
          out.push(Object.assign({}, v, { _brand: b.name, _model: m.name, _category: 'laptop' }));
        });
      });
    });
    return out;
  }

  function findVariant(id) {
    var all = flatVariants();
    for (var i = 0; i < all.length; i++) if (all[i].id === Number(id)) return all[i];
    return null;
  }

  // ---------- fake bookings, kept in this browser ----------
  function readOrders() {
    try { return JSON.parse(localStorage.getItem('demo_orders') || '{}'); } catch (e) { return {}; }
  }
  function writeOrders(o) { try { localStorage.setItem('demo_orders', JSON.stringify(o)); } catch (e) {} }

  function pad(n) { return String(n).padStart(4, '0'); }
  function nextCode() {
    var d = new Date();
    var key = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    var seq = Number(localStorage.getItem('demo_seq_' + key) || 0) + 1;
    localStorage.setItem('demo_seq_' + key, String(seq));
    return 'BB-' + key + '-' + pad(seq);
  }
  function stamp() {
    var d = new Date();
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200, headers: { 'content-type': 'application/json' },
    }));
  }

  function handle(url, opts) {
    var u = new URL(url, location.origin);
    var path = u.pathname;
    var method = (opts && opts.method) || 'GET';
    var body = opts && opts.body ? JSON.parse(opts.body) : {};

    if (path === '/api/config') return json(DATA.config);
    if (path === '/api/catalog') return json(DATA.catalog[u.searchParams.get('category')] || []);
    if (path === '/api/questions') return json(DATA.questions[u.searchParams.get('category')] || []);

    if (path === '/api/quote' && method === 'POST') {
      var v = findVariant(body.variantId);
      if (!v) return json({ error: 'Unknown device variant' }, 404);
      var qs = DATA.questions[body.category || v._category] || [];
      try { return json(valuate(v, qs, body.answers || {})); }
      catch (e) { return json({ error: e.message }, e.status || 400); }
    }

    if (path === '/api/orders' && method === 'POST') {
      var vv = findVariant(body.variantId);
      var qq = valuate(vv, DATA.questions[body.category || vv._category] || [], body.answers || {});
      var code = nextCode();
      var orders = readOrders();
      orders[code] = {
        code: code,
        status: 'pickup_scheduled',
        device: { label: qq.device.label, imei: (body.device && body.device.imei) || '',
          serial: (body.device && body.device.serial) || '' },
        estimate: { low: qq.range.low, high: qq.range.high, range: { text: qq.range.text } },
        pickup: { type: body.pickupType || 'pickup',
          date: (body.pickup && body.pickup.date) || null, slot: (body.pickup && body.pickup.slot) || '' },
        customer: body.customer || {},
        // the tracking page prints a "what you told us" table from this
        answers: (DATA.questions[body.category || vv._category] || [])
          .filter(function (q) { return body.answers && body.answers[q.code]; })
          .map(function (q) {
            var picked = null;
            for (var i = 0; i < q.options.length; i++) if (q.options[i].code === body.answers[q.code]) picked = q.options[i];
            return { question: q.label, answer: picked ? picked.label : body.answers[q.code] };
          }),
        timeline: [
          { status: 'order_created', note: 'Preview build — not sent to the business', at: stamp() },
          { status: 'pickup_scheduled', note: (body.pickupType === 'store' ? 'Store visit requested' : 'Collection requested'), at: stamp() },
        ],
        demo: true,
      };
      writeOrders(orders);
      // customer.js reads out.estimate.range.text, so the range lives inside estimate
      return json({ code: code, status: 'pickup_scheduled',
        estimate: Object.assign({}, qq.estimate, { range: qq.range }),
        range: qq.range, device: qq.device, demo: true });
    }

    var m = path.match(/^\/api\/orders\/([^/]+)(?:\/(accept|reject|photos|reschedule))?$/);
    if (m) {
      var orders2 = readOrders();
      var o = orders2[decodeURIComponent(m[1])];
      if (!o) return json({ error: 'Order not found. This is a preview build — bookings live only in the browser that made them.' }, 404);
      if (method === 'POST' && m[2]) {
        o.status = m[2] === 'accept' ? 'accepted' : 'rejected';
        o.timeline.push({ status: o.status, note: 'Preview build', at: stamp() });
        orders2[o.code] = o; writeOrders(orders2);
      }
      return json(o);
    }

    if (path === '/api/health') return json({ ok: true, demo: true, at: stamp() });
    return json({ error: 'Not available in the preview build' }, 404);
  }

  var nativeFetch = root.fetch ? root.fetch.bind(root) : null;

  function install(data) {
    DATA = data;
    STEP_MAJOR = data.pricing.roundingStep;
    RANGE_BP = data.pricing.rangePctBp;
    FLOOR_BP = data.pricing.floorPctBp;
    CURRENCY = data.pricing.currency;
    FACTOR = data.pricing.factor;

    root.fetch = function (input, opts) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/') === 0) return handle(url, opts);
      return nativeFetch ? nativeFetch(input, opts) : Promise.reject(new Error('offline'));
    };
  }

  // Node (parity test) can require this file; the browser loads it as a plain script.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = function (data) {
      DATA = data;
      STEP_MAJOR = data.pricing.roundingStep; RANGE_BP = data.pricing.rangePctBp;
      FLOOR_BP = data.pricing.floorPctBp; CURRENCY = data.pricing.currency; FACTOR = data.pricing.factor;
      return { valuate: valuate, flatVariants: flatVariants, findVariant: findVariant, fmt: fmt,
        setData: function (d) { DATA = d; } };
    };
  } else {
    root.DemoApi = { install: install, valuate: valuate };
    // The build inlines the snapshot into the page so this runs before customer.js asks for anything.
    if (root.__DEMO_DATA__) install(root.__DEMO_DATA__);
    else if (nativeFetch) {
      nativeFetch('/demo-data.json').then(function (r) { return r.json(); }).then(install).catch(function (e) {
        console.error('demo data failed to load', e);
      });
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
