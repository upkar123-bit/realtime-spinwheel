const gameService = require('./gameService');
const prisma = require('./prismaClient');
const payment = require('./paymentMock');
const { v4: uuidv4 } = require('uuid');

module.exports = function (io, redisClient) {
  io.on('connection', socket => {
    console.log('socket connected', socket.id);

    socket.on('wheel:create', async ({ hostId, title, segments, entryFee, maxPlayers }, ack) => {
      try {
        const { wheel, serverSeed } = await gameService.createWheel({ hostId, title, segments, entryFee, maxPlayers });
        // keep seed in memory (demo): in real, secure storage
        global.__wheelSeeds = global.__wheelSeeds || {};
        global.__wheelSeeds[wheel.id] = serverSeed;
        // notify clients with wheel and serverSeedHash (not seed)
        io.emit('wheel:created', wheel);
        ack && ack({ success: true, wheel });
      } catch (e) {
        console.error(e);
        ack && ack({ success: false, message: e.message });
      }
    });

    socket.on('wheel:join', async ({ userId, wheelId }, ack) => {
      try {
        const wheel = await prisma.wheel.findUnique({ where: { id: wheelId }});
        if (!wheel) throw new Error('Wheel not found');

        // Simulate payment
        const charge = await payment.charge(userId, wheel.entryFee);
        if (!charge.success) throw new Error('Payment failed');

        const join = await prisma.join.create({ data: { userId, wheelId, paid: true }});
        socket.join(`wheel_${wheelId}`);
        io.to(`wheel_${wheelId}`).emit('wheel:player_joined', { wheelId, userId });

        ack && ack({ success: true, join });
      } catch (e) {
        ack && ack({ success: false, message: e.message });
      }
    });

    socket.on('wheel:start', async ({ wheelId }, ack) => {
      try {
        const result = await gameService.startWheel(wheelId, io, redisClient);
        ack && ack({ success: true, result });
      } catch (e) {
        ack && ack({ success: false, message: e.message });
      }
    });

  });
};
