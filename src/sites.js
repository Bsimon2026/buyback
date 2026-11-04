'use strict';
// One backend, several front doors.
//
// Each hostname can serve its own landing page from public/sites/<name>/, while the quote
// flow, admin console, documents and database stay shared. Anything not listed here gets
// the default page at public/index.html.
//
// Add a domain by adding one line here and dropping a folder in public/sites/.
const SITES = {
  // page = landing page folder under public/sites/  |  phone = shown on that domain
  'sellformoney.com': { page: 'sellformoney', phone: '+971 52 399 2468',
    brand: { name: 'Sell for Money', emphasis: 'for', accent: '#007DFB',
      from: 'Sell for Money <code@notification.sellformoney.com>' } },
  'www.sellformoney.com': { page: 'sellformoney', phone: '+971 52 399 2468',
    brand: { name: 'Sell for Money', emphasis: 'for', accent: '#007DFB',
      from: 'Sell for Money <code@notification.sellformoney.com>' } },
};

// the house brand, used when no site claims the host
// Until notification.indubaicity.com is verified in Resend, the house site sends through the
// verified sellformoney subdomain (the display name is still the recycling brand).
const DEFAULT_BRAND = { name: 'in Dubai City', emphasis: 'Dubai', accent: '#C0392B',
  from: 'in Dubai City <code@notification.sellformoney.com>' };

/** Config overrides for a hostname, or null. */
function siteConfigFor(host) {
  const clean = String(host || '').toLowerCase().split(':')[0].trim();
  return clean ? (SITES[clean] || null) : null;
}

/** Returns the site folder name for a Host header, or null for the default page. */
function siteForHost(host) {
  const cfg = siteConfigFor(host);
  return cfg ? cfg.page : null;
}

function brandForHost(host) {
  const cfg = siteConfigFor(host);
  return (cfg && cfg.brand) || DEFAULT_BRAND;
}

module.exports = { SITES, siteForHost, siteConfigFor, brandForHost, DEFAULT_BRAND };
