#!/usr/bin/env node
// Prints fresh secrets for the manual setup path described in the README.
import { generateVapid, generateCode, PEOPLE_INFO } from './lib.mjs';
const v = generateVapid();
for (const p of Object.values(PEOPLE_INFO)) console.log(`${p.secretName}=${generateCode()}`);
console.log(`VAPID_PUBLIC_KEY=${v.publicKey}`);
console.log(`VAPID_PRIVATE_JWK=${JSON.stringify(v.privateJWK)}`);
