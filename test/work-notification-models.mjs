// Development fallback for hosts without Deno: run the existing service suites
// against the expiry/CAS model, not the native Deno KV engine.
import {Kv} from './notification-test-kv.mjs';
console.log('Notification compatibility suites use modeled KV and a deterministic clock in this runner.');
globalThis.Deno={openKv:async()=>new Kv()};
const NativeDate=Date;let at=Date.now();
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[at++]));}static now(){return at;}};
await import('./work-read-receipts.ts');
await import('./work-notification-events.ts');
await import('./work-notification-reminders.ts');
