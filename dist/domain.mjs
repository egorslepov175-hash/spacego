export function intervalsOverlap(a,b,c,d) {
  return new Date(a) < new Date(d) && new Date(b) > new Date(c);
}
export function rentalStatus(booking, now = Date.now()) {
  if (booking.cancelled) return 'cancelled';
  if (!booking.paid) return new Date(booking.end) <= now ? 'expired' : 'unpaid';
  return now < new Date(booking.start) ? 'upcoming' : now >= new Date(booking.end) ? 'completed' : 'active';
}
export function rentalQuote(space, rate, start, end) {
  const hours=(new Date(end)-new Date(start))/3600000;
  if (!Number.isFinite(hours)||hours<=0) throw new Error('Окончание аренды должно быть позже начала.');
  if (!['hour','day','month'].includes(rate) || !Number.isFinite(space[rate]) || space[rate]<=0) throw new Error('Этот тариф недоступен.');
  const unit=rate==='hour'?1:rate==='day'?24:720;
  const units=Math.ceil(hours/unit),rent=units*space[rate],fee=Math.round(rent*.15);
  return {rate,start,end,units,rent,fee,total:rent+fee};
}
