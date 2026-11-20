#!/usr/bin/env node
// Prints fresh secrets for the manual setup path described in the README.
import { generateVapid, generateCode } from './lib.mjs';
const v = generateVapid();
console.log(`TOKEN_MAXIME=${generateCode()}`);
console.log(`TOKEN_KATHRIN=${generateCode()}`);
console.log(`VAPID_PUBLIC_KEY=${v.publicKey}`);
console.log(`VAPID_PRIVATE_JWK=${JSON.stringify(v.privateJWK)}`);
