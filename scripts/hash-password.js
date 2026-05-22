#!/usr/bin/env node
// Hash a password with SHA-256 for use as ADMIN_PASSWORD_HASH in src/config.js
//
// Usage:
//   node scripts/hash-password.js YOUR_PASSWORD
//
// The output is a hex string. Paste it into src/config.js as
// the value of ADMIN_PASSWORD_HASH. Then commit and deploy.

import { createHash } from 'node:crypto'

const password = process.argv[2]

if (!password) {
  console.error('Usage: node scripts/hash-password.js YOUR_PASSWORD')
  console.error('')
  console.error('Pick a strong password (16+ characters, random). Example:')
  console.error('  node scripts/hash-password.js "k9#mPx2vN8qRfL!w"')
  console.error('')
  console.error('Then paste the printed hash into src/config.js.')
  process.exit(1)
}

if (password.length < 8) {
  console.warn('Warning: password is shorter than 8 characters. Use something longer.')
}

const hash = createHash('sha256').update(password).digest('hex')
console.log(hash)
