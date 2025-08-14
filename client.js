import Hyperswarm from 'hyperswarm'
import crypto from 'crypto'
import mic from 'mic'
import readline from 'readline'
import Speaker from 'speaker'

// Setup channel/topic
const channel = process.argv[2] || 'default-channel'
const topic = crypto.createHash('sha256').update(channel).digest()

const swarm = new Hyperswarm()
swarm.join(topic, { announce: true, lookup: true })

// Audio capture setup
const micInstance = mic({
  rate: '16000',
  channels: '1',
  debug: false,
  exitOnSilence: 0
})

// Audio playback setup
const speaker = new Speaker({
  channels: 1,
  bitDepth: 16,
  sampleRate: 16000
})

const micInputStream = micInstance.getAudioStream()

let connList = []
let talking = false

swarm.on('connection', (conn) => {
  console.log('Connected to peer')
  connList.push(conn)
  
  // Handle incoming audio data
  conn.on('data', (audioData) => {
    if (!talking) { // Only play audio when not talking (avoid feedback)
      speaker.write(audioData)
    }
  })
  
  // Clean up connection when it closes
  conn.on('close', () => {
    console.log('Peer disconnected')
    const index = connList.indexOf(conn)
    if (index > -1) {
      connList.splice(index, 1)
    }
  })
  
  conn.on('error', (err) => {
    console.error('Connection error:', err)
  })
})

function startTalking() {
  if (talking) return
  
  console.log('🎙️ Start talking...')
  talking = true
  micInstance.start()
  
  const onData = (data) => {
    connList.forEach(conn => {
      try {
        conn.write(data)
      } catch (err) {
        console.error('Error sending audio:', err)
      }
    })
  }
  
  micInputStream.on('data', onData)
  
  // Store the listener reference so we can remove it later
  micInputStream._onDataListener = onData
}

function stopTalking() {
  if (!talking) return
  
  console.log('🔇 Stop talking')
  talking = false
  micInstance.stop()
  
  // Remove the specific listener
  if (micInputStream._onDataListener) {
    micInputStream.removeListener('data', micInputStream._onDataListener)
    micInputStream._onDataListener = null
  }
}

// Manual PTT via keyboard
readline.emitKeypressEvents(process.stdin)
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
}

console.log('Press and hold SPACE to talk. Release to stop. Press q to quit.')

let spacePressed = false

process.stdin.on('keypress', (str, key) => {
  if (!key) return
  
  if (key.name === 'space' && !key.ctrl && !key.meta && !key.shift) {
    if (!spacePressed) {
      spacePressed = true
      startTalking()
    }
  } else if (key.name === 'q') {
    cleanup()
    process.exit(0)
  }
})

// Handle space key release
process.stdin.on('keypress', (str, key) => {
  if (key && key.name === 'space' && spacePressed) {
    // This is a bit tricky - we need to detect key release
    // For now, we'll use a timeout-based approach
    setTimeout(() => {
      if (spacePressed) {
        spacePressed = false
        stopTalking()
      }
    }, 50)
  }
})

// Better approach: Use a different key scheme
console.log('Alternative: Press "t" to toggle talk mode, "q" to quit')

let talkMode = false

process.stdin.on('keypress', (str, key) => {
  if (!key) return
  
  if (key.name === 't') {
    talkMode = !talkMode
    if (talkMode) {
      startTalking()
    } else {
      stopTalking()
    }
  }
})

function cleanup() {
  stopTalking()
  speaker.close()
  swarm.destroy()
}

// Handle process termination
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('exit', cleanup)