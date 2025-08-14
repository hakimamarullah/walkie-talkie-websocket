import { WebSocketServer } from 'ws'
import crypto from 'crypto'
import { createServer } from 'http'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 8080

class DatingWalkieTalkieServer {
    constructor() {
        this.wsClients = new Map() // ws -> { userId, profile, matchId?, status }
        this.waitingUsers = new Map() // userId -> { ws, profile, timestamp, notifiedNoMatch }
        this.activeMatches = new Map() // matchId -> { user1, user2, timestamp }
        this.stats = {
            usersOnline: 0,
            activeMatches: 0,
            totalMatches: 0
        }

        this.setupHttpServer()
        this.setupWebSocketServer()
        this.startMatchingEngine()

        console.log(`💕 Dating Walkie-Talkie Server starting on port ${PORT}`)
    }

    setupHttpServer() {
        this.httpServer = createServer((req, res) => {
            if (req.url === '/' || req.url === '/index.html') {
                try {
                    const html = readFileSync(join(__dirname, 'dating-walkie-talkie.html'), 'utf8')
                    res.writeHead(200, { 'Content-Type': 'text/html' })
                    res.end(html)
                } catch (error) {
                    res.writeHead(200, { 'Content-Type': 'text/html' })
                    res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>💕 Dating Walkie-Talkie Server</title>
              <style>
                body { 
                  font-family: Arial, sans-serif; 
                  max-width: 800px; 
                  margin: 0 auto; 
                  padding: 20px;
                  background: linear-gradient(135deg, #ff6b6b, #ffa8a8);
                  color: white;
                }
                .container { 
                  background: rgba(255,255,255,0.1); 
                  padding: 30px; 
                  border-radius: 15px;
                  backdrop-filter: blur(10px);
                }
                .stats { 
                  display: grid; 
                  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
                  gap: 15px; 
                  margin: 20px 0; 
                }
                .stat-card { 
                  background: rgba(255,255,255,0.15); 
                  padding: 15px; 
                  border-radius: 10px; 
                  text-align: center; 
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>💕 Dating Walkie-Talkie Server</h1>
                <p>Server is running on port ${PORT}</p>
                <p>WebSocket endpoint: <code>ws://localhost:${PORT}/ws</code></p>
                
                <div class="stats">
                  <div class="stat-card">
                    <h3>👥 Users Online</h3>
                    <div id="usersOnline">0</div>
                  </div>
                  <div class="stat-card">
                    <h3>💑 Active Matches</h3>
                    <div id="activeMatches">0</div>
                  </div>
                  <div class="stat-card">
                    <h3>📊 Total Matches</h3>
                    <div id="totalMatches">0</div>
                  </div>
                </div>
                
                <p>Place your dating-walkie-talkie.html file in the same directory to serve it.</p>
                
                <h3>🚀 Features:</h3>
                <ul>
                  <li>💖 Smart matching based on preferences</li>
                  <li>🎙️ Real-time voice communication</li>
                  <li>⏭️ Skip to next match instantly</li>
                  <li>🔒 Privacy-focused (no data stored)</li>
                </ul>
              </div>
              
              <script>
                setInterval(() => {
                  fetch('/stats')
                    .then(r => r.json())
                    .then(stats => {
                      document.getElementById('usersOnline').textContent = stats.usersOnline;
                      document.getElementById('activeMatches').textContent = Object.keys(stats.activeMatches || {}).length;
                      document.getElementById('totalMatches').textContent = stats.totalMatches;
                    })
                    .catch(e => console.error('Failed to fetch stats:', e));
                }, 2000);
              </script>
            </body>
            </html>
          `)
                }
            } else if (req.url === '/stats') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    ...this.stats,
                    activeMatches: Object.keys(this.activeMatches).length,
                    waitingUsers: this.waitingUsers.size
                }))
            } else {
                res.writeHead(404)
                res.end('Not Found')
            }
        })

        this.httpServer.listen(PORT, () => {
            console.log(`📡 HTTP server listening on http://localhost:${PORT}`)
            console.log(`💕 Ready to help people find love through voice!`)
        })
    }

    setupWebSocketServer() {
        this.wss = new WebSocketServer({
            server: this.httpServer,
            path: '/ws'
        })

        this.wss.on('connection', (ws) => {
            const userId = this.generateUserId()
            console.log(`👤 New user connected: ${userId}`)

            this.wsClients.set(ws, {
                userId,
                profile: null,
                matchId: null,
                status: 'connected'
            })
            this.updateStats()

            ws.on('message', (data) => {
                this.handleWebSocketMessage(ws, data)
            })

            ws.on('close', () => {
                this.handleUserDisconnect(ws)
            })

            ws.on('error', (error) => {
                console.error(`❌ WebSocket error for ${userId}:`, error)
                this.handleUserDisconnect(ws)
            })

            // Send welcome message
            this.sendToWebSocket(ws, {
                type: 'connected',
                message: 'Welcome to Dating Walkie-Talkie! 💕'
            })
        })
    }

    startMatchingEngine() {
        // Run matching algorithm every 2 seconds
        setInterval(() => {
            this.processMatching()
        }, 2000)

        // Clean up old waiting users every 30 seconds
        setInterval(() => {
            this.cleanupWaitingUsers()
        }, 30000)

        // Clean up inactive matches every minute
        setInterval(() => {
            this.cleanupInactiveMatches()
        }, 60000)
    }

    handleWebSocketMessage(ws, data) {
        const clientInfo = this.wsClients.get(ws)
        if (!clientInfo) return

        try {
            // Handle binary audio data
            if (data instanceof Buffer && clientInfo.matchId) {
                this.relayAudioToMatch(clientInfo.matchId, clientInfo.userId, data)
                return
            }

            // Handle JSON messages
            const message = JSON.parse(data.toString())
            console.log(`📨 Message from ${clientInfo.userId}: ${message.type}`)

            switch (message.type) {
                case 'find_match':
                    this.handleFindMatch(ws, message.profile)
                    break
                case 'next_match':
                    this.handleNextMatch(ws, message.profile)
                    break
                case 'end_match':
                    this.handleEndMatch(ws)
                    break
                case 'end_session':
                    this.handleUserDisconnect(ws)
                    break
                default:
                    console.log(`❓ Unknown message type from ${clientInfo.userId}:`, message.type)
            }
        } catch (error) {
            console.error(`❌ Error handling message from ${clientInfo.userId}:`, error)
        }
    }

    handleFindMatch(ws, profile) {
        const clientInfo = this.wsClients.get(ws)
        if (!clientInfo) return

        // Clean up any existing state first
        this.cleanupUserFromWaiting(clientInfo.userId)
        if (clientInfo.matchId) {
            this.handleEndMatch(ws, false) // Don't add back to waiting
        }

        // Update client profile and status
        clientInfo.profile = {
            ...profile,
            timestamp: Date.now()
        }
        clientInfo.status = 'waiting'

        console.log(`💖 ${clientInfo.userId} (${profile.name}, ${profile.age}, ${profile.gender}) looking for ${profile.lookingFor}`)

        // Add to waiting pool with fresh state
        this.waitingUsers.set(clientInfo.userId, {
            ws,
            profile: clientInfo.profile,
            timestamp: Date.now(),
            notifiedNoMatch: false
        })

        this.updateStats()

        // Send waiting confirmation
        this.sendToWebSocket(ws, {
            type: 'searching',
            message: 'Looking for your perfect match... 💕'
        })

        // Try immediate matching
        this.processMatching()
    }

    handleNextMatch(ws, profile) {
        const clientInfo = this.wsClients.get(ws)
        if (!clientInfo) return

        console.log(`⏭️ ${clientInfo.userId} requesting next match`)

        // End current match first
        if (clientInfo.matchId) {
            this.handleEndMatch(ws, false) // Don't add back to waiting
        }

        // Small delay to ensure cleanup is complete
        setTimeout(() => {
            this.handleFindMatch(ws, profile)
        }, 100)
    }

    processMatching() {
        const waitingArray = Array.from(this.waitingUsers.entries())
        if (waitingArray.length < 2) {
            // Handle "no matches" notification for users waiting too long
            this.handleNoMatchesFound()
            return
        }

        console.log(`🔍 Processing matching for ${waitingArray.length} waiting users`)

        // Try to find compatible matches
        for (let i = 0; i < waitingArray.length; i++) {
            for (let j = i + 1; j < waitingArray.length; j++) {
                const [userId1, user1] = waitingArray[i]
                const [userId2, user2] = waitingArray[j]

                // Skip if either user is no longer in waiting (race condition protection)
                if (!this.waitingUsers.has(userId1) || !this.waitingUsers.has(userId2)) {
                    continue
                }

                if (this.areCompatible(user1.profile, user2.profile)) {
                    this.createMatch(userId1, user1, userId2, user2)
                    return // Process one match at a time
                }
            }
        }

        // If no matches found, handle notifications
        this.handleNoMatchesFound()
    }

    handleNoMatchesFound() {
        const now = Date.now()
        const notificationThreshold = 8000 // 8 seconds wait before first notification
        const retryThreshold = 10000 // 15 seconds between notifications

        for (const [userId, user] of this.waitingUsers.entries()) {
            const waitTime = now - user.timestamp

            // Send notification if user has been waiting long enough and hasn't been notified recently
            if (!user.notifiedNoMatch && waitTime > notificationThreshold) {
                this.sendToWebSocket(user.ws, {
                    type: 'no_matches',
                    message: 'Still looking for compatible matches... 🔍'
                })

                user.notifiedNoMatch = true
                user.lastNotification = now
                console.log(`💔 No matches notification sent to ${userId} (waited ${Math.round(waitTime/1000)}s)`)
            }
            // Re-notify if it's been a while since last notification
            else if (user.notifiedNoMatch && user.lastNotification && (now - user.lastNotification) > retryThreshold) {
                this.sendToWebSocket(user.ws, {
                    type: 'no_matches',
                    message: 'Expanding search criteria... 🌟'
                })

                user.lastNotification = now
                console.log(`💔 Re-notification sent to ${userId} (total wait: ${Math.round(waitTime/1000)}s)`)
            }
        }
    }

    areCompatible(profile1, profile2) {
        // Check mutual compatibility
        const user1WantsUser2 = profile1.lookingFor === 'any' || profile1.lookingFor === profile2.gender
        const user2WantsUser1 = profile2.lookingFor === 'any' || profile2.lookingFor === profile1.gender

        // Age compatibility (within 15 years)
        const ageDifference = Math.abs(profile1.age - profile2.age)
        const ageCompatible = ageDifference <= 15

        const compatible = user1WantsUser2 && user2WantsUser1 && ageCompatible

        if (!compatible) {
            console.log(`❌ Incompatible: ${profile1.name} (${profile1.gender}, wants ${profile1.lookingFor}) ↔ ${profile2.name} (${profile2.gender}, wants ${profile2.lookingFor}), age diff: ${ageDifference}`)
        }

        return compatible
    }

    createMatch(userId1, user1, userId2, user2) {
        const matchId = this.generateMatchId()

        // Remove from waiting pool
        this.waitingUsers.delete(userId1)
        this.waitingUsers.delete(userId2)

        // Create match record
        this.activeMatches.set(matchId, {
            user1: { userId: userId1, ws: user1.ws, profile: user1.profile },
            user2: { userId: userId2, ws: user2.ws, profile: user2.profile },
            timestamp: Date.now()
        })

        // Update client records
        const client1 = this.wsClients.get(user1.ws)
        const client2 = this.wsClients.get(user2.ws)
        if (client1) {
            client1.matchId = matchId
            client1.status = 'matched'
        }
        if (client2) {
            client2.matchId = matchId
            client2.status = 'matched'
        }

        this.stats.totalMatches++
        this.updateStats()

        console.log(`💑 Created match ${matchId}: ${user1.profile.name} ↔ ${user2.profile.name}`)

        // Notify both users
        this.sendToWebSocket(user1.ws, {
            type: 'match_found',
            matchId,
            partner: {
                name: user2.profile.name,
                age: user2.profile.age,
                gender: user2.profile.gender,
                location: user2.profile.location
            }
        })

        this.sendToWebSocket(user2.ws, {
            type: 'match_found',
            matchId,
            partner: {
                name: user1.profile.name,
                age: user1.profile.age,
                gender: user1.profile.gender,
                location: user1.profile.location
            }
        })
    }

    handleEndMatch(ws, addBackToWaiting = false) {
        const clientInfo = this.wsClients.get(ws)
        if (!clientInfo?.matchId) return

        const matchId = clientInfo.matchId
        const match = this.activeMatches.get(matchId)

        if (!match) {
            // Clean up orphaned match reference
            clientInfo.matchId = null
            clientInfo.status = 'connected'
            return
        }

        const isUser1 = match.user1.userId === clientInfo.userId
        const partner = isUser1 ? match.user2 : match.user1

        console.log(`💔 ${clientInfo.userId} ended match ${matchId}`)

        // Notify partner if still connected
        if (partner.ws && partner.ws.readyState === 1) {
            this.sendToWebSocket(partner.ws, {
                type: 'match_ended',
                reason: 'Your partner ended the match'
            })

            // Reset partner's match ID and status
            const partnerClient = this.wsClients.get(partner.ws)
            if (partnerClient) {
                partnerClient.matchId = null
                partnerClient.status = 'connected'
            }
        }

        // Clean up match
        this.activeMatches.delete(matchId)
        clientInfo.matchId = null
        clientInfo.status = addBackToWaiting ? 'waiting' : 'connected'

        this.updateStats()

        // Optionally add user back to waiting pool (for regular end_match, not next_match)
        if (addBackToWaiting && clientInfo.profile) {
            setTimeout(() => {
                if (!clientInfo.matchId && clientInfo.status === 'waiting') {
                    this.waitingUsers.set(clientInfo.userId, {
                        ws,
                        profile: clientInfo.profile,
                        timestamp: Date.now(),
                        notifiedNoMatch: false
                    })
                }
            }, 500)
        }
    }

    relayAudioToMatch(matchId, senderUserId, audioData) {
        const match = this.activeMatches.get(matchId)
        if (!match) return

        const isUser1 = match.user1.userId === senderUserId
        const recipient = isUser1 ? match.user2 : match.user1

        // Send audio to the other user in the match
        if (recipient.ws && recipient.ws.readyState === 1) {
            try {
                recipient.ws.send(audioData, { binary: true })
                console.log(`🎙️ Relayed audio in match ${matchId}: ${audioData.length} bytes`)
            } catch (error) {
                console.error(`❌ Failed to relay audio in match ${matchId}:`, error)
            }
        }
    }

    cleanupUserFromWaiting(userId) {
        if (this.waitingUsers.has(userId)) {
            console.log(`🧹 Removing ${userId} from waiting pool`)
            this.waitingUsers.delete(userId)
        }
    }

    handleUserDisconnect(ws) {
        const clientInfo = this.wsClients.get(ws)
        if (!clientInfo) return

        console.log(`👋 User disconnected: ${clientInfo.userId}`)

        // Remove from waiting pool
        this.cleanupUserFromWaiting(clientInfo.userId)

        // Handle active match
        if (clientInfo.matchId) {
            const match = this.activeMatches.get(clientInfo.matchId)
            if (match) {
                const isUser1 = match.user1.userId === clientInfo.userId
                const partner = isUser1 ? match.user2 : match.user1

                // Notify partner
                if (partner.ws && partner.ws.readyState === 1) {
                    this.sendToWebSocket(partner.ws, {
                        type: 'partner_disconnected',
                        message: 'Your partner disconnected'
                    })

                    // Reset partner's match ID
                    const partnerClient = this.wsClients.get(partner.ws)
                    if (partnerClient) {
                        partnerClient.matchId = null
                        partnerClient.status = 'connected'
                    }
                }

                // Clean up match
                this.activeMatches.delete(clientInfo.matchId)
            }
        }

        // Remove client
        this.wsClients.delete(ws)
        this.updateStats()
    }

    cleanupWaitingUsers() {
        const now = Date.now()
        const timeout = 5 * 60 * 1000 // 5 minutes

        for (const [userId, user] of this.waitingUsers.entries()) {
            if (now - user.timestamp > timeout) {
                console.log(`🧹 Cleaning up inactive waiting user: ${userId}`)

                // Notify user of timeout
                if (user.ws && user.ws.readyState === 1) {
                    this.sendToWebSocket(user.ws, {
                        type: 'search_timeout',
                        message: 'Search timed out. Please try again.'
                    })

                    const clientInfo = this.wsClients.get(user.ws)
                    if (clientInfo) {
                        clientInfo.status = 'connected'
                    }
                }

                this.waitingUsers.delete(userId)
            }
        }
    }

    cleanupInactiveMatches() {
        const now = Date.now()
        const timeout = 10 * 60 * 1000 // 10 minutes

        for (const [matchId, match] of this.activeMatches.entries()) {
            if (now - match.timestamp > timeout) {
                console.log(`🧹 Cleaning up inactive match: ${matchId}`)

                    // Notify users if still connected
                    [match.user1, match.user2].forEach(user => {
                    if (user.ws && user.ws.readyState === 1) {
                        this.sendToWebSocket(user.ws, {
                            type: 'match_ended',
                            reason: 'Match timed out due to inactivity'
                        })

                        const clientInfo = this.wsClients.get(user.ws)
                        if (clientInfo) {
                            clientInfo.matchId = null
                            clientInfo.status = 'connected'
                        }
                    }
                })

                this.activeMatches.delete(matchId)
            }
        }
    }

    updateStats() {
        this.stats.usersOnline = this.wsClients.size
        this.stats.activeUsers = this.waitingUsers.size + (this.activeMatches.size * 2)

        // Broadcast stats to all connected users
        const statsMessage = {
            type: 'stats_update',
            stats: {
                usersOnline: this.stats.usersOnline,
                activeMatches: this.activeMatches.size,
                totalMatches: this.stats.totalMatches,
                waitingUsers: this.waitingUsers.size
            }
        }

        this.wsClients.forEach((clientInfo, ws) => {
            this.sendToWebSocket(ws, statsMessage)
        })
    }

    sendToWebSocket(ws, message) {
        if (ws && ws.readyState === 1) {
            try {
                ws.send(JSON.stringify(message))
            } catch (error) {
                console.error('❌ Error sending WebSocket message:', error)
            }
        }
    }

    generateUserId() {
        return 'user_' + crypto.randomBytes(6).toString('hex')
    }

    generateMatchId() {
        return 'match_' + crypto.randomBytes(8).toString('hex')
    }
}

// Start the server
const server = new DatingWalkieTalkieServer()

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n💔 Shutting down Dating Walkie-Talkie server...')
    server.httpServer.close()
    process.exit(0)
})

process.on('SIGTERM', () => {
    server.httpServer.close()
    process.exit(0)
})

// Log stats periodically
setInterval(() => {
    console.log(`📊 Stats - Online: ${server.stats.usersOnline}, Waiting: ${server.waitingUsers.size}, Active Matches: ${server.activeMatches.size}, Total Matches: ${server.stats.totalMatches}`)
}, 30000) // Every 30 seconds