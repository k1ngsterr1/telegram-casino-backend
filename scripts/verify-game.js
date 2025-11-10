/**
 * Provably Fair Aviator - Verification Script
 * 
 * This script allows anyone to independently verify that an Aviator game
 * result was generated fairly using the provably fair algorithm.
 * 
 * Usage:
 *   node verify-game.js <serverSeed> <clientSeed> <nonce> [targetRtp] [instantCrashP]
 * 
 * Example:
 *   node verify-game.js a3f8b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0 b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6 1 0.89 0.01
 */

const crypto = require('crypto');

// Default settings (match server defaults)
const DEFAULT_TARGET_RTP = 0.89;
const DEFAULT_INSTANT_CRASH_P = 0.01;
const MIN_MULTIPLIER = 1.0;
const MAX_MULTIPLIER = 100000;

/**
 * Generate HMAC-SHA256 hash
 */
function hmacSha256(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

/**
 * Convert hash to uniform random value [0, 1)
 */
function uniformFromHash(hexHash) {
  // Take top 52 bits for precision
  const top52Hex = hexHash.substring(0, 13); // 52 bits = 13 hex chars
  const top52 = parseInt(top52Hex, 16);
  const maxValue = Math.pow(2, 52);
  return top52 / maxValue;
}

/**
 * Check if hash is divisible by modulus
 */
function isDivisible(hexHash, modulus) {
  let val = 0;
  const offset = hexHash.length % 4;
  let i = offset > 0 ? offset - 4 : 0;

  while (i < hexHash.length) {
    const chunk = hexHash.substring(i, Math.min(i + 4, hexHash.length));
    val = ((val << 16) + parseInt(chunk, 16)) % modulus;
    i += 4;
  }

  return val === 0;
}

/**
 * Calculate crash multiplier using provably fair algorithm
 */
function calculateMultiplier(serverSeed, clientSeed, nonce, targetRtp, instantCrashP) {
  // 1. Generate HMAC hash
  const message = `${clientSeed}:${nonce}`;
  const hexHash = hmacSha256(serverSeed, message);

  console.log('\n📊 Calculation Steps:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`1. Message: "${message}"`);
  console.log(`2. HMAC-SHA256 Hash: ${hexHash}`);

  // 2. Check for instant crash
  const instantCrashModulus = Math.max(2, Math.round(1.0 / instantCrashP));
  const isInstantCrash = isDivisible(hexHash, instantCrashModulus);
  
  console.log(`3. Instant Crash Check (divisible by ${instantCrashModulus}): ${isInstantCrash ? 'YES' : 'NO'}`);

  if (isInstantCrash) {
    console.log(`   → Result: Instant crash at ${MIN_MULTIPLIER}x`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return MIN_MULTIPLIER;
  }

  // 3. Generate uniform random value
  let U = uniformFromHash(hexHash);
  U = Math.max(U, 1e-12); // Protection from zero
  
  console.log(`4. Uniform Random Value (U): ${U}`);

  // 4. Apply inverse distribution
  const K = targetRtp * (1.0 - instantCrashP);
  let multiplier = K / U;
  
  console.log(`5. Calibration Coefficient (K): ${targetRtp} × ${1 - instantCrashP} = ${K}`);
  console.log(`6. Raw Multiplier: ${K} / ${U} = ${multiplier}`);

  // 5. Apply boundaries
  const clampedMultiplier = Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, multiplier));
  const finalMultiplier = Math.round(clampedMultiplier * 100) / 100;

  console.log(`7. After Clamping: ${clampedMultiplier}`);
  console.log(`8. Final Multiplier (rounded to 2 decimals): ${finalMultiplier}x`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return finalMultiplier;
}

/**
 * Main verification function
 */
function verifyGame(serverSeed, clientSeed, nonce, targetRtp, instantCrashP) {
  console.log('\n🔍 Provably Fair Aviator - Game Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Server Seed:       ${serverSeed}`);
  console.log(`Client Seed:       ${clientSeed}`);
  console.log(`Nonce:             ${nonce}`);
  console.log(`Target RTP:        ${targetRtp * 100}%`);
  console.log(`Instant Crash P:   ${instantCrashP * 100}%`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Validate inputs
  if (serverSeed.length !== 64 || !/^[0-9a-f]+$/i.test(serverSeed)) {
    throw new Error('Server seed must be 64 hexadecimal characters');
  }
  if (clientSeed.length !== 32 || !/^[0-9a-f]+$/i.test(clientSeed)) {
    throw new Error('Client seed must be 32 hexadecimal characters');
  }
  if (!Number.isInteger(nonce) || nonce < 1) {
    throw new Error('Nonce must be a positive integer');
  }

  const result = calculateMultiplier(serverSeed, clientSeed, nonce, targetRtp, instantCrashP);

  console.log('✅ Verification Complete!');
  console.log(`\n🎯 Final Result: ${result}x\n`);

  return result;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('\n❌ Error: Missing required arguments\n');
    console.log('Usage: node verify-game.js <serverSeed> <clientSeed> <nonce> [targetRtp] [instantCrashP]\n');
    console.log('Example:');
    console.log('  node verify-game.js \\');
    console.log('    a3f8b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0 \\');
    console.log('    b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6 \\');
    console.log('    1 \\');
    console.log('    0.89 \\');
    console.log('    0.01\n');
    process.exit(1);
  }

  const [serverSeed, clientSeed, nonceStr, targetRtpStr, instantCrashPStr] = args;
  const nonce = parseInt(nonceStr, 10);
  const targetRtp = targetRtpStr ? parseFloat(targetRtpStr) : DEFAULT_TARGET_RTP;
  const instantCrashP = instantCrashPStr ? parseFloat(instantCrashPStr) : DEFAULT_INSTANT_CRASH_P;

  try {
    verifyGame(serverSeed, clientSeed, nonce, targetRtp, instantCrashP);
  } catch (error) {
    console.error(`\n❌ Verification Failed: ${error.message}\n`);
    process.exit(1);
  }
}

// Export for use as module
module.exports = {
  verifyGame,
  calculateMultiplier,
  hmacSha256,
  uniformFromHash,
  isDivisible,
};
