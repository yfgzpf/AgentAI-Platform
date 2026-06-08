/**
 * AgentAI Gateway 入口
 * 阶段 1 占位实现
 */
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';

const PORT = Number(process.env.GATEWAY_PORT) || 18789;
const HOST = process.env.GATEWAY_HOST || '127.0.0.1';

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'agentai-gateway',
        version: '0.1.0-alpha.1',
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const io = new SocketServer(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.info(`[Gateway] Client connected: ${socket.id}`);

  socket.on('chat', (msg) => {
    console.info(`[Gateway] Chat: ${JSON.stringify(msg)}`);
    // TODO 阶段 2: 转发到 @agentai/core 调度
    socket.emit('chat:reply', {
      type: 'message',
      content: `AgentAI Gateway 已收到: ${msg?.content ?? '(empty)'}`,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    console.info(`[Gateway] Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.info(`✅ AgentAI Gateway running at http://${HOST}:${PORT}`);
  console.info(`   WebSocket: ws://${HOST}:${PORT}`);
  console.info(`   Health: http://${HOST}:${PORT}/health`);
});

// 优雅退出
process.on('SIGINT', () => {
  console.info('\n[Gateway] Shutting down...');
  httpServer.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.info('\n[Gateway] SIGTERM received, shutting down...');
  httpServer.close(() => process.exit(0));
});
