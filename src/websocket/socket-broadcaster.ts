import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import * as http from 'http';

let io: Server | null = null;

/**
 * Bootstraps the Socket.IO WebSocket cluster, registering the Redis Pub/Sub Adapter.
 */
export function initSocket(server: http.Server): Server {


  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    }
  });

  // adapter removed

  io.on('connection', (socket) => {
    logger.debug(`🔌 WebSocket client connection established: ${socket.id}`);

    // Join general streaming rooms
    socket.on('subscribe:transfers', () => {
      socket.join('room:transfers');
      logger.debug(`🔌 Client [${socket.id}] subscribed to room:transfers`);
    });

    socket.on('subscribe:swaps', () => {
      socket.join('room:swaps');
      logger.debug(`🔌 Client [${socket.id}] subscribed to room:swaps`);
    });

    socket.on('subscribe:nfts', () => {
      socket.join('room:nfts');
      logger.debug(`🔌 Client [${socket.id}] subscribed to room:nfts`);
    });

    // Join dynamic asset-specific rooms
    socket.on('subscribe:token', (tokenAddress: string) => {
      const room = `room:transfers:${tokenAddress.toLowerCase()}`;
      socket.join(room);
      logger.debug(`🔌 Client [${socket.id}] subscribed to ${room}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`🔌 WebSocket client connection closed: ${socket.id}`);
    });
  });

  logger.info('🚀 Socket.IO Server successfully bound in-memory.');
  return io;
}

export type BroadcastType = 'transfer' | 'swap' | 'nft';

/**
 * Broadcasts enriched transaction records dynamically to appropriate Socket.IO rooms.
 */
export function broadcastEvent(type: BroadcastType, data: any) {
  if (!io) {
    logger.warn('⚠️ Cannot broadcast event: Socket.IO has not been initialized.');
    return;
  }

  switch (type) {
    case 'transfer':
      // Broadcast to global transfers room
      io.to('room:transfers').emit('transfer', data);
      // Broadcast to specific token room
      if (data.tokenAddress) {
        const tokenRoom = `room:transfers:${data.tokenAddress.toLowerCase()}`;
        io.to(tokenRoom).emit('transfer', data);
      }
      logger.debug(`📢 Broadcasted transfer event ${data.txHash} to WebSockets`);
      break;

    case 'swap':
      // Broadcast to global swaps room
      io.to('room:swaps').emit('swap', data);
      // Broadcast to dynamic swap token rooms
      if (data.tokenInSymbol) {
        io.to(`room:swaps:${data.tokenInSymbol.toLowerCase()}`).emit('swap', data);
      }
      if (data.tokenOutSymbol) {
        io.to(`room:swaps:${data.tokenOutSymbol.toLowerCase()}`).emit('swap', data);
      }
      logger.debug(`📢 Broadcasted DEX swap event ${data.txHash} to WebSockets`);
      break;

    case 'nft':
      // Broadcast to global NFT events room
      io.to('room:nfts').emit('nft', data);
      // Broadcast to dynamic NFT contract room
      if (data.contractAddress) {
        io.to(`room:nfts:${data.contractAddress.toLowerCase()}`).emit('nft', data);
      }
      logger.debug(`📢 Broadcasted NFT event ${data.txHash} to WebSockets`);
      break;
  }
}
