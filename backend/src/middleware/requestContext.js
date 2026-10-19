/**
 * requestContext.js — a short reference ("ref") for every request and job run
 * (N42, Phase 3 section F).
 *
 * The ref is what HR quotes from an error message ("ref: K7Q2MX") and what a
 * developer pastes into Super Admin → Logs & errors to find the whole trail.
 * It lives in AsyncLocalStorage, so every log line written while the request
 * (or job) is being handled carries it — including lines from services that
 * know nothing about `req` — without passing it around.
 *
 * Deliberately has no imports from the app: config/logger.js reads it, and the
 * logger loads before almost everything else.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomInt } from 'node:crypto';

const storage = new AsyncLocalStorage();

// No 0/O, 1/I/L: the ref is read aloud and typed from a screenshot.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INCOMING_REF = /^[A-Za-z0-9_-]{4,64}$/;

/** A new 6-character ref, e.g. "K7Q2MX". */
export function newRef(length = 6) {
  let s = '';
  for (let i = 0; i < length; i += 1) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** The current request / job context, or undefined outside one. */
export function getContext() {
  return storage.getStore();
}

/** The current ref, or null. */
export function currentRef() {
  return storage.getStore()?.requestId ?? null;
}

/**
 * Run `fn` inside a context (used by the job runner and tests).
 * @template T
 * @param {{requestId: string, [k: string]: any}} ctx
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithContext(ctx, fn) {
  return storage.run(ctx, fn);
}

/**
 * Adds the signed-in user to the current context. Called by `authenticate`
 * once it has loaded the user (the context object is shared, so mutating it
 * reaches every later log line of the same request).
 */
export function setContextUser(user) {
  const ctx = storage.getStore();
  if (ctx && user) {
    ctx.userId = user.id ?? null;
    ctx.role = user.role ?? null;
  }
}

/**
 * Express middleware — mount first. Accepts a sane incoming `x-request-id`
 * (e.g. from a proxy), otherwise creates one, and echoes it back in the
 * `x-request-id` response header.
 * @type {import('express').RequestHandler}
 */
export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  const requestId = incoming && INCOMING_REF.test(incoming) ? incoming : newRef();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  storage.run(
    { requestId, userId: null, role: null, method: req.method, route: (req.originalUrl || '').split('?')[0] },
    next,
  );
}
