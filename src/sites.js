'use strict';
// One backend, several front doors.
//
// Each hostname can serve its own landing page from public/sites/<name>/, while the quote
// flow, admin console, documents and database stay shared. Anything not listed here gets
// the default page at public/index.html.
//
// Add a domain by adding one line here and dropping a folder in public/sites/.
const SITES = {
  'sellformoney.com': 'sellformoney',
  'www.sellformoney.com': 'sellformoney',
};

/** Returns the site folder name for a Host header, or null for the default page. */
function siteForHost(host) {
  const clean = String(host || '').toLowerCase().split(':')[0].trim();
  if (!clean) return null;
  return SITES[clean] || null;
}

module.exports = { SITES, siteForHost };
