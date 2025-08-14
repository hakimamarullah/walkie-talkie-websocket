import {WebSocketServer} from 'ws'
import crypto from 'crypto'
import {createServer} from 'http'
import {readFileSync} from 'fs'
import {fileURLToPath} from 'url'
import {dirname, join} from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 8080

class WalkieTalkieServer {
    constructor() {
        this.wsClients = new Map() // ws -> { userId }
        this.stats = {usersOnline: 0}

        this.setupHttpServer()
        this.setupWebSocketServer()

        console.log(`📡 Walkie-Talkie Server starting on port ${PORT}`)
    }

    setupHttpServer() {
        this.httpServer = createServer((req, res) => {
            if (req.url === '/' || req.url === '/index.html') {
                try {
                    const html = readFileSync(join(__dirname, 'walkie-talkie.html'), 'utf8')
                    res.writeHead(200, {'Content-Type': 'text/html'})
                    res.end(html)
                } catch {
                    res.writeHead(200, {'Content-Type': 'text/html'})
                    res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>📡 Walkie-Talkie Server</title></head>
            <body>
              <h1>Walkie-Talkie Server Running</h1>
              <p>WebSocket: ws://localhost:${PORT}/ws</p>
              <p>Connected Users: <span id="count">0</span></p>
              <script>
                setInterval(() => {
                  fetch('/stats')
                    .then(r => r.json())
                    .then(s => document.getElementById('count').textContent = s.usersOnline)
                }, 1000)
              </script>
            </body>
            </html>
          `)
                }
            } else if (req.url === '/stats') {
                res.writeHead(200, {'Content-Type': 'application/json'})
                res.end(JSON.stringify(this.stats))
            } else {
                res.writeHead(404)
                res.end('Not Found')
            }
        })

        this.httpServer.listen(PORT, () => {
            console.log(`HTTP server listening on http://localhost:${PORT}`)
        })
    }

    setupWebSocketServer() {
        this.wss = new WebSocketServer({
            server: this.httpServer,
            path: '/ws'
        })

        this.wss.on('connection', (ws) => {
            const userId = this.generateUserId()
            console.log(`👤 User connected: ${userId}`)

            this.wsClients.set(ws, {userId})
            this.updateStats()

            ws.on('message', (data) => this.handleMessage(ws, data))
            ws.on('close', () => this.handleDisconnect(ws))
            ws.on('error', () => this.handleDisconnect(ws))

            this.sendToWebSocket(ws, {type: 'connected', message: 'Welcome to Walkie-Talkie 📡'})
        })
    }

    handleMessage(ws, data) {
        const sender = this.wsClients.get(ws)
        if (!sender) return

        // If it's binary (audio), relay to everyone except sender
        if (data instanceof Buffer) {
            for (const [client] of this.wsClients.entries()) {
                if (client !== ws && client.readyState === 1) {
                    client.send(data, {binary: true})
                }
            }
            console.log(`🎙️ Relayed audio from ${sender.userId} to others`)
            return
        }

        // If it's text/JSON, just log or handle commands if needed
        try {
            const msg = JSON.parse(data.toString())
            console.log(`📩 Message from ${sender.userId}:`, msg)
        } catch {
            console.log(`📩 Text from ${sender.userId}: ${data.toString()}`)
        }
    }

    handleDisconnect(ws) {
        const clientInfo = this.wsClients.get(ws)
        if (!clientInfo) return
        console.log(`👋 User disconnected: ${clientInfo.userId}`)

        this.wsClients.delete(ws)
        this.updateStats()
    }

    updateStats() {
        this.stats.usersOnline = this.wsClients.size
        const statsMessage = {type: 'stats_update', stats: this.stats}
        this.broadcast(statsMessage)
    }

    broadcast(message) {
        for (const ws of this.wsClients.keys()) {
            this.sendToWebSocket(ws, message)
        }
    }

    sendToWebSocket(ws, message) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify(message))
        }
    }

    generateUserId() {
        return 'user_' + crypto.randomBytes(6).toString('hex')
    }
}

const server = new WalkieTalkieServer()

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down Walkie-Talkie server...')
    server.httpServer.close()
    process.exit(0)
})

process.on('SIGTERM', () => {
    server.httpServer.close()
    process.exit(0)
})

// Log stats periodically
setInterval(() => {
    console.log(`📊 Stats - Online: ${server.stats.usersOnline}`)
}, 60000) // Every 30 seconds