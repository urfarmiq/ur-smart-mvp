// Staging shares production authorization and paid-access enforcement.
// Do not restore a standalone satellite handler that can bypass these checks.
export {default} from './worker.js';
