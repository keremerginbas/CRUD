'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const rec = (id, extra) => ({id, category: 'arsa', area: 1000, price: 5000000, currency: 'TRY', location: {city: 'Ankara', district: 'Gölbaşı'}, phones: [], ...extra});
test('same province, district, area and price across sites form one group', () => {
  const {groups, byId} = core.duplicateGroups([rec('sahibinden:1'), rec('hepsiemlak:2-3', {area: 1000.4}), rec('emlakjet:9', {price: 6000000})]);
  assert.equal(groups.length, 1); assert.deepEqual([...groups[0]].sort(), ['hepsiemlak:2-3', 'sahibinden:1']);
  assert.equal(byId.has('emlakjet:9'), false);
});
test('shared phone and area joins listings with different prices', () => {
  const {groups} = core.duplicateGroups([rec('a', {phones: ['905321234567']}), rec('b', {price: 5100000, phones: ['905321234567']}), rec('c', {price: 5200000})]);
  assert.equal(groups.length, 1); assert.deepEqual([...groups[0]].sort(), ['a', 'b']);
});
test('deleted, area-less and price-less records are ignored', () => {
  assert.equal(core.duplicateGroups([rec('a'), rec('b', {deletedAt: '2026-01-01'}), rec('c', {area: null}), rec('d', {price: null})]).groups.length, 0);
});
