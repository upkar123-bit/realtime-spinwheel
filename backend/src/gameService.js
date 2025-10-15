const crypto = require('crypto');
const prisma = require('./prismaClient');
const { randomUUID } = require('crypto');
const REDIS_LOCK_PREFIX = 'lock:wheel:';

async function createWheel({ hostId, title, segments, entryFee, maxPlayers, startsAt }) {
  // serverSeedHash: publish H(seed) to clients before reveal
  const seed = crypto.randomBytes(32).toString('hex'); // secret until reveal
  const seedHash = crypto.createHash('sha256').update(seed).digest('hex');
  const wheel = await prisma.wheel.create({
    data: {
      hostId, title, segments: segments, entryFee, maxPlayers, startsAt,
      serverSeedHash: seedHash
    }
  });
  return { wheel, serverSeed: seed }; // serverSeed returned for server runtime (do not expose)
}

function deterministicSpinIndex(serverSeed, nonce, segments) {
  // serverSeed: hex string, nonce: integer
  // create HMAC: HMAC-SHA256(serverSeed, nonce)
  const h = crypto.createHmac('sha256', serverSeed).update(String(nonce)).digest('hex');
  const num = parseInt(h.slice(0, 15), 16); // large number
  // map to weighted segments: segments is array [{ label, weight }]
  const totalWeight = segments.reduce((s, seg) => s + (seg.weight || 1), 0);
  const pick = num % totalWeight;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    acc += segments[i].weight || 1;
    if (pick < acc) return i;
  }
  return segments.length - 1;
}

async function startWheel(wheelId, io, redisClient) {
  // Acquire an advisory lock in DB or redis to avoid double starts
  // For simplicity, use Redis SETNX lock with expiry
  const lockKey = REDIS_LOCK_PREFIX + wheelId;
  const acquired = await redisClient.set(lockKey, '1', { NX: true, PX: 10000 });
  if (!acquired) throw new Error('Wheel already starting');

  // fetch wheel and joins
  const wheel = await prisma.wheel.findUnique({ where: { id: wheelId }, include: { joins: true }});
  if (!wheel) throw new Error('Wheel not found');
  if (wheel.status !== 'waiting') throw new Error('Wheel not in waiting state');

  // compute prize pool
  const players = wheel.joins.filter(j => j.paid);
  const pool = players.length * wheel.entryFee;

  // pick winner via deterministic spin
  const nonce = Date.now(); // or an incrementing counter per wheel
  // server must keep serverSeed private until after reveal.
  // Fetch serverSeed from an in-memory store or secure vault. For demo assume we have it:
  const serverSeed = global.__wheelSeeds && global.__wheelSeeds[wheelId];
  if (!serverSeed) throw new Error('Missing server seed');

  const segments = wheel.segments; // stored as JSON
  const winningIndex = deterministicSpinIndex(serverSeed, nonce, segments);
  const winnerSegment = segments[winningIndex];

  // determine winner user — map index to player depending on design: either segments are equal to players or segments are prizes and winner chosen among players randomly.
  // For this implementation: pick a random player index by mapping hash to players length:
  const hash = crypto.createHmac('sha256', serverSeed).update(String(nonce)).digest('hex');
  const num = parseInt(hash.slice(0, 15), 16);
  const winnerIdx = num % players.length;
  const winnerJoin = players[winnerIdx];

  // award payout (all pool to winner)
  const payout = pool;
  await prisma.$transaction(async (tx) => {
    await tx.join.update({ where: { id: winnerJoin.id }, data: { payout }});
    await tx.user.update({ where: { id: winnerJoin.userId }, data: { balance: { increment: payout } }});
    await tx.wheel.update({ where: { id: wheelId }, data: { status: 'finished', serverSeed }});
  });

  // release lock
  await redisClient.del(lockKey);

  // notify clients
  io.to(`wheel_${wheelId}`).emit('wheel:finished', {
    wheelId, nonce, serverSeedHash: wheel.serverSeedHash, serverSeed, winner: winnerJoin.userId, payout, winningSegment
  });

  return { winner: winnerJoin.userId, payout, winningSegment, nonce };
}

module.exports = { createWheel, startWheel, deterministicSpinIndex };
