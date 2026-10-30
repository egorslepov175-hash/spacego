import test from 'node:test';
import assert from 'node:assert/strict';
import {rentalQuote,rentalStatus,intervalsOverlap} from '../dist/domain.mjs';

const space={hour:150,day:750,month:6500};
test('short hourly rental includes a rounded 15% service fee',()=>{
 const q=rentalQuote(space,'hour','2026-10-27T10:00:00Z','2026-10-27T11:30:00Z');
 assert.deepEqual({units:q.units,rent:q.rent,fee:q.fee,total:q.total},{units:2,rent:300,fee:45,total:345});
});
test('daily and 30-day tariffs round up partial periods',()=>{
 assert.equal(rentalQuote(space,'day','2026-10-27T10:00:00Z','2026-10-28T10:01:00Z').rent,1500);
 assert.equal(rentalQuote(space,'month','2026-10-01T10:00:00Z','2026-10-31T10:00:00Z').rent,6500);
});
test('invalid time intervals and unavailable tariffs are rejected',()=>{
 assert.throws(()=>rentalQuote(space,'day','bad','bad'));
 assert.throws(()=>rentalQuote(space,'day','2026-10-27','2026-10-26'));
 assert.throws(()=>rentalQuote({...space,hour:0},'hour','2026-10-27','2026-10-28'));
});
test('adjacent intervals are allowed; contained and intersecting intervals conflict',()=>{
 assert.equal(intervalsOverlap('2026-10-27T10:00Z','2026-10-27T12:00Z','2026-10-27T12:00Z','2026-10-27T14:00Z'),false);
 assert.equal(intervalsOverlap('2026-10-27T10:00Z','2026-10-27T12:00Z','2026-10-27T11:00Z','2026-10-27T11:30Z'),true);
});
test('access follows the paid rental interval, including exact boundaries',()=>{
 const b={paid:true,start:'2026-10-27T10:00Z',end:'2026-10-27T12:00Z'};
 assert.equal(rentalStatus(b,Date.parse('2026-10-27T09:59Z')),'upcoming');
 assert.equal(rentalStatus(b,Date.parse(b.start)),'active');
 assert.equal(rentalStatus(b,Date.parse(b.end)),'completed');
 assert.equal(rentalStatus({...b,cancelled:true},Date.parse(b.start)),'cancelled');
 assert.equal(rentalStatus({...b,paid:false},Date.parse(b.start)),'unpaid');
 assert.equal(rentalStatus({...b,paid:false},Date.parse(b.end)),'expired');
});
